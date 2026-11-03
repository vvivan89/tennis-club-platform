-- Verified event-only accounts and explicit confirmation of every tournament pair.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'member';
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_kind_check
    CHECK (account_kind IN ('member','event_guest'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.tournament_participants
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz DEFAULT now();
DO $$ BEGIN
  ALTER TABLE public.tournament_participants ADD CONSTRAINT tournament_participants_confirmation_status_check
    CHECK (confirmation_status IN ('pending','confirmed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE public.tournament_participants
  SET confirmed_at=coalesce(confirmed_at,created_at),confirmation_status='confirmed'
  WHERE confirmation_status='confirmed';

-- A first-time magic-link user may create an event-only profile without entering
-- membership application fields. The account_kind is still restricted to event_guest.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_guest boolean := new.raw_user_meta_data->>'account_kind'='event_guest';
BEGIN
  IF NOT v_event_guest THEN
    IF coalesce(new.raw_user_meta_data->>'tennis_skill_level','') NOT IN ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') THEN
      RAISE EXCEPTION 'A valid tennis skill rating is required to register.';
    END IF;
    IF coalesce(trim(new.raw_user_meta_data->>'phone'),'')='' THEN
      RAISE EXCEPTION 'A phone number is required to register.';
    END IF;
  END IF;
  INSERT INTO public.profiles(id,email,full_name,phone,tennis_skill_level,account_kind)
  VALUES (
    new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),
    CASE WHEN v_event_guest THEN '' ELSE trim(new.raw_user_meta_data->>'phone') END,
    CASE WHEN v_event_guest THEN NULL ELSE new.raw_user_meta_data->>'tennis_skill_level' END,
    CASE WHEN v_event_guest THEN 'event_guest' ELSE 'member' END
  );
  RETURN new;
END;
$$;

-- Only verified authenticated event guests can create public entries. Partner details
-- are saved as pending until the invited player signs in and confirms them.
CREATE OR REPLACE FUNCTION public.register_event_guest_tournament_entry(
  p_event_id uuid,p_category text,p_display_name text,p_phone text,p_gender text,
  p_tennis_skill_level numeric,p_partner_name text DEFAULT NULL,p_partner_email text DEFAULT NULL,
  p_partner_phone text DEFAULT NULL,p_partner_gender text DEFAULT NULL,
  p_partner_skill_level numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid:=auth.uid(); v_profile public.profiles%rowtype; v_partner public.profiles%rowtype;
  v_auth_email text; v_auth_confirmed timestamptz; v_event public.events%rowtype; v_config jsonb; v_league_gender text;
  v_partner_user uuid; v_own_id uuid; v_partner_id uuid; v_pair_id uuid; v_amount integer;
  v_partner_member boolean:=false; v_has_partner boolean; v_partner_gender_effective text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Verify your email before registering'; END IF;
  SELECT email,email_confirmed_at INTO v_auth_email,v_auth_confirmed FROM auth.users WHERE id=v_user;
  IF v_auth_email IS NULL OR v_auth_confirmed IS NULL THEN
    RAISE EXCEPTION 'Verify your email before registering';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user AND account_kind='event_guest';
  IF NOT FOUND OR lower(v_profile.email)<>lower(v_auth_email) THEN RAISE EXCEPTION 'Event-only registration session required'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament' AND status='published';
  IF NOT FOUND OR NOT v_event.allow_non_member_registration THEN RAISE EXCEPTION 'This event does not accept event-only registration'; END IF;
  IF now()<v_event.registration_opens_at OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at) OR now()>=v_event.starts_at THEN
    RAISE EXCEPTION 'Event registration is closed';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160 OR length(btrim(coalesce(p_phone,'')))>40 THEN
    RAISE EXCEPTION 'Enter a valid name and phone number';
  END IF;
  IF p_tennis_skill_level IS NOT NULL AND NOT (p_tennis_skill_level BETWEEN 2.5 AND 7 AND mod(p_tennis_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender'; END IF;
  v_config:=coalesce(v_event.tournament_config,'{}'::jsonb);
  IF v_event.social_doubles_ladder_id IS NOT NULL THEN
    SELECT gender INTO v_league_gender FROM public.social_doubles_ladders
      WHERE id=v_event.social_doubles_ladder_id AND competition_type='league';
    IF v_league_gender IS NOT NULL THEN p_category:=CASE WHEN v_league_gender='male' THEN 'men' ELSE 'women' END; END IF;
  END IF;
  IF v_event.tournament_format='team' THEN
    IF p_category<>'team' THEN RAISE EXCEPTION 'Invalid team tournament category'; END IF;
  ELSIF p_category NOT IN ('mixed','men','women') OR NOT (coalesce(v_config->'categories','["mixed","men","women"]'::jsonb) ? p_category) THEN
    RAISE EXCEPTION 'This tournament category is unavailable';
  END IF;
  IF p_category='men' AND p_gender IS NOT NULL AND p_gender<>'male' THEN RAISE EXCEPTION 'This gender is not eligible for men''s doubles'; END IF;
  IF p_category='women' AND p_gender IS NOT NULL AND p_gender<>'female' THEN RAISE EXCEPTION 'This gender is not eligible for women''s doubles'; END IF;
  v_has_partner:=nullif(btrim(p_partner_name),'') IS NOT NULL OR nullif(btrim(p_partner_email),'') IS NOT NULL;
  IF v_has_partner AND (nullif(btrim(p_partner_name),'') IS NULL OR nullif(btrim(p_partner_email),'') IS NULL) THEN
    RAISE EXCEPTION 'Enter both your partner''s name and email';
  END IF;
  IF v_has_partner AND (v_event.tournament_format<>'doubles' OR coalesce(v_config->>'registration_mode','both')='single') THEN
    RAISE EXCEPTION 'This event does not accept partner registration';
  END IF;
  IF NOT v_has_partner AND v_event.tournament_format='doubles' AND coalesce(v_config->>'registration_mode','both')='doubles' THEN
    RAISE EXCEPTION 'Register with a partner for this event';
  END IF;
  IF p_partner_skill_level IS NOT NULL AND NOT (p_partner_skill_level BETWEEN 2.5 AND 7 AND mod(p_partner_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Partner skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender'; END IF;
  IF p_category='men' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'male' THEN RAISE EXCEPTION 'Partner gender is not eligible for men''s doubles'; END IF;
  IF p_category='women' AND p_partner_gender IS NOT NULL AND p_partner_gender<>'female' THEN RAISE EXCEPTION 'Partner gender is not eligible for women''s doubles'; END IF;
  IF v_has_partner AND p_category='mixed' AND p_gender IN ('male','female') AND p_partner_gender IN ('male','female') AND p_gender=p_partner_gender THEN
    RAISE EXCEPTION 'Mixed doubles requires one male and one female player';
  END IF;

  SELECT * INTO v_partner FROM public.profiles WHERE lower(email)=lower(btrim(p_partner_email)) LIMIT 1;
  IF FOUND THEN
    IF v_partner.id=v_user THEN RAISE EXCEPTION 'You cannot register as your own partner'; END IF;
    IF v_partner.account_kind='member' THEN
      v_partner_user:=v_partner.id; v_partner_member:=true;
    ELSIF v_partner.account_kind='event_guest' THEN
      v_partner_user:=v_partner.id;
    ELSE
      RAISE EXCEPTION 'Partner email belongs to an account that must sign in through member login';
    END IF;
  END IF;
  v_partner_gender_effective:=CASE WHEN v_partner_member THEN v_partner.gender ELSE coalesce(v_partner.gender,p_partner_gender) END;
  IF v_has_partner AND p_category='men' AND v_partner_gender_effective IS NOT NULL AND v_partner_gender_effective<>'male' THEN
    RAISE EXCEPTION 'Partner gender is not eligible for men''s doubles';
  END IF;
  IF v_has_partner AND p_category='women' AND v_partner_gender_effective IS NOT NULL AND v_partner_gender_effective<>'female' THEN
    RAISE EXCEPTION 'Partner gender is not eligible for women''s doubles';
  END IF;
  IF v_has_partner AND p_category='mixed' AND p_gender IN ('male','female')
    AND v_partner_gender_effective IN ('male','female') AND p_gender=v_partner_gender_effective THEN
    RAISE EXCEPTION 'Mixed doubles requires one male and one female player';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants WHERE event_id=p_event_id AND user_id=v_user AND category=p_category AND status IN ('registered','provisional')) THEN
    RAISE EXCEPTION 'You are already registered in this category';
  END IF;
  v_amount:=greatest(coalesce(v_event.price_cents,0),0);
  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,amount_cents,payment_status,confirmation_status,confirmed_at)
  VALUES(p_event_id,v_user,p_category,btrim(p_display_name),lower(v_auth_email),nullif(btrim(p_phone),''),p_gender,p_tennis_skill_level,v_amount,
    CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,'confirmed',now()) RETURNING id INTO v_own_id;
  IF v_has_partner THEN
    INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,amount_cents,payment_status,status,confirmation_status,confirmed_at)
    VALUES(p_event_id,v_partner_user,p_category,
      CASE WHEN v_partner_member THEN coalesce(nullif(v_partner.full_name,''),v_partner.email)
        WHEN v_partner_user IS NOT NULL THEN coalesce(nullif(v_partner.full_name,''),nullif(btrim(p_partner_name),''),v_partner.email)
        ELSE btrim(p_partner_name) END,
      lower(btrim(p_partner_email)),
      CASE WHEN v_partner_member THEN nullif(v_partner.phone,'')
        WHEN v_partner_user IS NOT NULL THEN coalesce(nullif(v_partner.phone,''),nullif(btrim(p_partner_phone),''))
        ELSE nullif(btrim(p_partner_phone),'') END,
      CASE WHEN v_partner_member THEN v_partner.gender ELSE coalesce(v_partner.gender,p_partner_gender) END,
      CASE WHEN v_partner_member THEN NULL ELSE coalesce(v_partner.tennis_skill_level::numeric,p_partner_skill_level) END,
      v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,'provisional','pending',NULL)
    RETURNING id INTO v_partner_id;
    INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
    VALUES(p_event_id,p_category,v_own_id,v_partner_id) RETURNING id INTO v_pair_id;
  END IF;
  RETURN jsonb_build_object('participantId',v_own_id,'partnerParticipantId',v_partner_id,'pairId',v_pair_id,
    'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,
    'partnerIsMember',v_partner_member,'partnerEmail',CASE WHEN v_has_partner THEN lower(btrim(p_partner_email)) ELSE NULL END);
END; $$;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric) TO authenticated;

-- Every partner invited by a member must confirm before the pair can be paid.
ALTER FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric)
  RENAME TO register_tournament_entry_confirmed_base;
REVOKE ALL ON FUNCTION public.register_tournament_entry_confirmed_base(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.register_tournament_entry(
 p_event_id uuid,p_category text,p_display_name text,p_email text,p_phone text,p_gender text,
 p_partner_participant_id uuid,p_partner_name text,p_partner_email text,p_partner_phone text,
 p_partner_gender text,p_partner_user_id uuid,p_tennis_skill_level numeric,p_partner_tennis_skill_level numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_partner_id uuid; v_partner public.profiles%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before registering'; END IF;
  v_result:=public.register_tournament_entry_confirmed_base(p_event_id,p_category,p_display_name,p_email,p_phone,p_gender,
    p_partner_participant_id,p_partner_name,p_partner_email,p_partner_phone,p_partner_gender,p_partner_user_id,
    p_tennis_skill_level,p_partner_tennis_skill_level);
  v_partner_id:=nullif(v_result->>'partnerParticipantId','')::uuid;
  IF v_partner_id IS NOT NULL THEN
    UPDATE public.tournament_participants SET confirmation_status='pending',confirmed_at=NULL
      WHERE id=v_partner_id;
    SELECT * INTO v_partner FROM public.profiles WHERE id=p_partner_user_id;
    v_result:=v_result||jsonb_build_object('partnerIsMember',p_partner_user_id IS NOT NULL,
      'partnerEmail',coalesce(v_partner.email,p_partner_email));
  END IF;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text,uuid,numeric,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_tournament_entry(uuid,text,text,text,text,text,uuid,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_tournament_partner(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid:=auth.uid(); v_email text; v_confirmed_at timestamptz;
  v_event public.events%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to confirm this invitation'; END IF;
  SELECT email_confirmed_at,email INTO v_confirmed_at,v_email FROM auth.users WHERE id=v_user;
  IF v_confirmed_at IS NULL OR v_email IS NULL THEN RAISE EXCEPTION 'Verify the invited email first'; END IF;
  SELECT e.* INTO v_event FROM public.events e JOIN public.tournament_participants p ON p.event_id=e.id
    WHERE p.id=p_participant_id;
  IF NOT FOUND OR v_event.status<>'published' OR now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN
    RAISE EXCEPTION 'The event registration cutoff has passed';
  END IF;
  UPDATE public.tournament_participants p SET user_id=v_user,confirmation_status='confirmed',confirmed_at=now(),status='registered',updated_at=now()
  WHERE p.id=p_participant_id AND p.confirmation_status='pending' AND lower(p.email)=lower(v_email)
    AND p.status IN ('registered','provisional')
    AND EXISTS (SELECT 1 FROM public.tournament_pairs pair WHERE pair.event_id=p.event_id AND pair.status='active'
      AND p.id IN (pair.player_one_id,pair.player_two_id))
    AND NOT EXISTS (SELECT 1 FROM public.tournament_pairs pair JOIN public.tournament_participants other
      ON other.id IN (pair.player_one_id,pair.player_two_id) AND other.id<>p.id
      WHERE pair.event_id=p.event_id AND pair.status='active' AND p.id IN (pair.player_one_id,pair.player_two_id) AND other.user_id=v_user);
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation does not match your verified email or is no longer available'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.confirm_tournament_partner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_tournament_partner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_unconfirmed_tournament_partner(
  p_participant_id uuid,p_partner_user_id uuid DEFAULT NULL,p_partner_name text DEFAULT NULL,
  p_partner_email text DEFAULT NULL,p_partner_phone text DEFAULT NULL,p_partner_gender text DEFAULT NULL,
  p_partner_skill_level numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid:=auth.uid(); v_own public.tournament_participants%rowtype;
  v_partner public.tournament_participants%rowtype; v_event public.events%rowtype;
  v_existing public.profiles%rowtype; v_pair public.tournament_pairs%rowtype;
  v_user_id uuid; v_member boolean:=false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to change your partner'; END IF;
  SELECT * INTO v_own FROM public.tournament_participants
    WHERE id=p_participant_id AND user_id=v_user AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your active event entry was not found'; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs WHERE event_id=v_own.event_id
    AND status='active' AND p_participant_id IN (player_one_id,player_two_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active partner is assigned'; END IF;
  SELECT * INTO v_partner FROM public.tournament_participants
    WHERE id=CASE WHEN v_pair.player_one_id=p_participant_id THEN v_pair.player_two_id ELSE v_pair.player_one_id END FOR UPDATE;
  IF v_partner.confirmation_status<>'pending' THEN RAISE EXCEPTION 'A confirmed partner cannot be changed'; END IF;
  IF v_pair.league_team_id IS NOT NULL THEN RAISE EXCEPTION 'An established League team partner cannot be changed'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_own.event_id;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN RAISE EXCEPTION 'The registration cutoff has passed'; END IF;

  IF p_partner_user_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.profiles WHERE id=p_partner_user_id
      AND application_status='approved' AND account_kind='member';
    IF NOT FOUND OR p_partner_user_id=v_user THEN RAISE EXCEPTION 'Select an eligible member partner'; END IF;
    v_user_id:=v_existing.id; v_member:=true;
  ELSE
    IF nullif(btrim(p_partner_name),'') IS NULL OR nullif(btrim(p_partner_email),'') IS NULL
      OR length(btrim(p_partner_name))>160 OR length(btrim(p_partner_email))>254 THEN
      RAISE EXCEPTION 'Enter a valid partner name and email';
    END IF;
    SELECT * INTO v_existing FROM public.profiles WHERE lower(email)=lower(btrim(p_partner_email)) LIMIT 1;
    IF FOUND THEN
      IF v_existing.id=v_user THEN RAISE EXCEPTION 'You cannot register as your own partner'; END IF;
      IF v_existing.account_kind='member' THEN
        v_user_id:=v_existing.id; v_member:=true;
      ELSIF v_existing.account_kind='event_guest' THEN v_user_id:=v_existing.id;
      ELSE RAISE EXCEPTION 'Partner email belongs to an account that must sign in through member login'; END IF;
    END IF;
  END IF;
  IF p_partner_skill_level IS NOT NULL AND NOT (p_partner_skill_level BETWEEN 2.5 AND 7 AND mod(p_partner_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Invalid partner skill rating';
  END IF;
  IF p_partner_gender IS NOT NULL AND p_partner_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid partner gender'; END IF;
  IF v_own.category='mixed' AND v_own.gender IN ('male','female') AND p_partner_gender IN ('male','female') AND v_own.gender=p_partner_gender THEN
    RAISE EXCEPTION 'Mixed doubles requires one male and one female player';
  END IF;
  UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_partner.id AND confirmation_status='pending';
  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,
    amount_cents,payment_status,status,confirmation_status,confirmed_at)
  VALUES(v_own.event_id,v_user_id,v_own.category,
    CASE WHEN v_member THEN coalesce(nullif(v_existing.full_name,''),v_existing.email)
      WHEN v_user_id IS NOT NULL THEN coalesce(nullif(v_existing.full_name,''),nullif(btrim(p_partner_name),''),v_existing.email)
      ELSE btrim(p_partner_name) END,
    CASE WHEN v_member THEN lower(v_existing.email) ELSE lower(btrim(p_partner_email)) END,
    CASE WHEN v_member THEN nullif(v_existing.phone,'')
      WHEN v_user_id IS NOT NULL THEN coalesce(nullif(v_existing.phone,''),nullif(btrim(p_partner_phone),''))
      ELSE nullif(btrim(p_partner_phone),'') END,
    CASE WHEN v_member THEN v_existing.gender ELSE coalesce(v_existing.gender,p_partner_gender) END,
    CASE WHEN v_member THEN NULL ELSE coalesce(v_existing.tennis_skill_level::numeric,p_partner_skill_level) END,
    v_own.amount_cents,v_own.payment_status,'provisional','pending',NULL) RETURNING * INTO v_partner;
  INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
    VALUES(v_own.event_id,v_own.category,v_own.id,v_partner.id);
  RETURN jsonb_build_object('partnerParticipantId',v_partner.id,'partnerEmail',v_partner.email,'partnerIsMember',v_member);
END; $$;
REVOKE ALL ON FUNCTION public.update_unconfirmed_tournament_partner(uuid,uuid,text,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_unconfirmed_tournament_partner(uuid,uuid,text,text,text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_unconfirmed_tournament_partner(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid:=auth.uid(); v_own public.tournament_participants%rowtype; v_pair public.tournament_pairs%rowtype;
  v_event public.events%rowtype; v_partner_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to change your registration'; END IF;
  SELECT * INTO v_own FROM public.tournament_participants WHERE id=p_participant_id AND user_id=v_user AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your active event entry was not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_own.event_id;
  IF v_event.tournament_format<>'doubles' OR coalesce(v_event.tournament_config->>'registration_mode','both')='doubles' THEN
    RAISE EXCEPTION 'This event does not allow single registration';
  END IF;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN RAISE EXCEPTION 'The registration cutoff has passed'; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs WHERE event_id=v_own.event_id AND status='active'
    AND p_participant_id IN (player_one_id,player_two_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active partner is assigned'; END IF;
  IF v_pair.league_team_id IS NOT NULL THEN RAISE EXCEPTION 'An established League team cannot switch to a single entry'; END IF;
  v_partner_id:=CASE WHEN v_pair.player_one_id=p_participant_id THEN v_pair.player_two_id ELSE v_pair.player_one_id END;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=v_partner_id AND confirmation_status='pending') THEN
    RAISE EXCEPTION 'A confirmed partner cannot be removed';
  END IF;
  UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_partner_id;
END; $$;
REVOKE ALL ON FUNCTION public.remove_unconfirmed_tournament_partner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_unconfirmed_tournament_partner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_event_guest_registration_details(
  p_participant_id uuid,p_display_name text,p_phone text,p_gender text,p_tennis_skill_level numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.tournament_participants%rowtype; v_event public.events%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND account_kind='event_guest'
  ) THEN RAISE EXCEPTION 'Event-only registration session required'; END IF;
  SELECT * INTO v_entry FROM public.tournament_participants
    WHERE id=p_participant_id AND user_id=auth.uid() AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your active event entry was not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_entry.event_id;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN
    RAISE EXCEPTION 'The registration cutoff has passed';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160
    OR length(btrim(coalesce(p_phone,'')))>40 THEN RAISE EXCEPTION 'Enter a valid name and phone number'; END IF;
  IF p_gender IS NOT NULL AND p_gender NOT IN ('male','female','other','prefer_not_to_say') THEN RAISE EXCEPTION 'Invalid gender'; END IF;
  IF (v_entry.category='men' AND p_gender IS NOT NULL AND p_gender<>'male')
    OR (v_entry.category='women' AND p_gender IS NOT NULL AND p_gender<>'female') THEN
    RAISE EXCEPTION 'This gender is not eligible for the registered category';
  END IF;
  IF p_tennis_skill_level IS NOT NULL AND NOT (p_tennis_skill_level BETWEEN 2.5 AND 7 AND mod(p_tennis_skill_level-2.5,0.5)=0) THEN
    RAISE EXCEPTION 'Skill level must be between 2.5 and 7.0 in 0.5 increments';
  END IF;
  UPDATE public.tournament_participants SET display_name=btrim(p_display_name),phone=nullif(btrim(p_phone),''),
    gender=p_gender,tennis_skill_level=p_tennis_skill_level,updated_at=now() WHERE id=v_entry.id;
END; $$;
REVOKE ALL ON FUNCTION public.update_event_guest_registration_details(uuid,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_event_guest_registration_details(uuid,text,text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_tournament_my_entries(p_event_id uuid)
RETURNS TABLE(id uuid,team_id uuid,category text,display_name text,email text,phone text,gender text,tennis_skill_level numeric,
  payment_status text,amount_cents integer,confirmation_status text,partner_id uuid,partner_name text,partner_email text,
  partner_phone text,partner_gender text,partner_skill_level numeric,partner_confirmation_status text,partner_is_league_team boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT own.id,own.team_id,own.category,own.display_name,own.email,own.phone,coalesce(own.gender_override,own.gender),own.tennis_skill_level,
    own.payment_status,own.amount_cents,own.confirmation_status,partner.id,partner.display_name,partner.email,partner.phone,
    coalesce(partner.gender_override,partner.gender),partner.tennis_skill_level,partner.confirmation_status,(pair.league_team_id IS NOT NULL)
  FROM public.tournament_participants own
  LEFT JOIN public.tournament_pairs pair ON pair.event_id=own.event_id AND pair.status='active'
    AND own.id IN (pair.player_one_id,pair.player_two_id)
  LEFT JOIN public.tournament_participants partner ON partner.id=CASE WHEN pair.player_one_id=own.id THEN pair.player_two_id ELSE pair.player_one_id END
  WHERE own.event_id=p_event_id AND own.user_id=auth.uid() AND own.status IN ('registered','provisional')
  ORDER BY own.created_at,own.category;
$$;
REVOKE ALL ON FUNCTION public.event_tournament_my_entries(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_my_entries(uuid) TO authenticated;

-- Manager-assigned pairs require explicit confirmation from both participants.
CREATE OR REPLACE FUNCTION public.admin_create_tournament_pair(p_event_id uuid,p_category text,p_one uuid,p_two uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pair uuid;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (public.is_admin() OR e.created_by=auth.uid() OR e.organizer_id=auth.uid())) THEN
    RAISE EXCEPTION 'Event manager access required';
  END IF;
  IF p_one=p_two OR NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=p_one AND event_id=p_event_id AND category=p_category AND status='registered')
    OR NOT EXISTS (SELECT 1 FROM public.tournament_participants WHERE id=p_two AND event_id=p_event_id AND category=p_category AND status='registered') THEN
    RAISE EXCEPTION 'Select two registered participants in the same category';
  END IF;
  INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id)
    VALUES(p_event_id,p_category,p_one,p_two) RETURNING id INTO v_pair;
  UPDATE public.tournament_participants SET confirmation_status='pending',confirmed_at=NULL,updated_at=now()
    WHERE id IN (p_one,p_two);
  RETURN v_pair;
END; $$;
REVOKE ALL ON FUNCTION public.admin_create_tournament_pair(uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_create_tournament_pair(uuid,text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_require_pair_confirmation(p_pair_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event uuid; v_one uuid; v_two uuid;
BEGIN
  SELECT event_id,player_one_id,player_two_id INTO v_event,v_one,v_two
    FROM public.tournament_pairs WHERE id=p_pair_id AND status='active' FOR UPDATE;
  IF NOT FOUND OR NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=v_event AND
      (public.is_admin() OR e.created_by=auth.uid() OR e.organizer_id=auth.uid())
  ) THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  UPDATE public.tournament_participants SET confirmation_status='pending',confirmed_at=NULL,updated_at=now()
    WHERE id IN (v_one,v_two) AND event_id=v_event AND status='registered';
  IF NOT FOUND THEN RAISE EXCEPTION 'Both pair members must have active registrations'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_require_pair_confirmation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_require_pair_confirmation(uuid) TO authenticated;

-- Publicly enabled League events may also contain event-only players. Existing
-- rostered League members remain locked to their confirmed League teammates.
CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_league uuid; v_gender text; v_allow_guest boolean; v_one uuid; v_two uuid;
  v_one_status text; v_two_status text; v_one_confirm text; v_two_confirm text; v_one_email text; v_two_email text;
  v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender,e.allow_non_member_registration
    INTO v_league,v_gender,v_allow_guest
  FROM public.events e JOIN public.social_doubles_ladders l
    ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id,p1.status,p2.status,p1.confirmation_status,p2.confirmation_status,p1.email,p2.email
    INTO v_one,v_two,v_one_status,v_two_status,v_one_confirm,v_two_confirm,v_one_email,v_two_email
    FROM public.tournament_participants p1,public.tournament_participants p2
    WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF (v_one IS NULL AND NOT (v_allow_guest AND v_one_status='provisional' AND v_one_confirm='pending' AND v_one_email IS NOT NULL))
    OR (v_two IS NULL AND NOT (v_allow_guest AND v_two_status='provisional' AND v_two_confirm='pending' AND v_two_email IS NOT NULL)) THEN
    RAISE EXCEPTION 'League teams require two verified players or an invited event-only partner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two)
      AND NOT (p.application_status='approved' AND p.account_kind='member')
      AND NOT (v_allow_guest AND p.account_kind IN ('event_guest','member'))
  ) THEN RAISE EXCEPTION 'League participants must be approved members or verified event-only registrants'; END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two)
      OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,(p.user_id IS NOT NULL) AS is_member
FROM public.tournament_participants p JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered' AND p.confirmation_status='confirmed'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));
CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id,p.event_id,p.category,p.player_one_id,p.player_two_id,p.group_number,p.seed,p.status,
  a.display_name AS player_one_name,b.display_name AS player_two_name,
  coalesce(a.tennis_skill_level::text,profile_a.tennis_skill_level) AS player_one_skill_level,
  coalesce(b.tennis_skill_level::text,profile_b.tennis_skill_level) AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id AND a.status='registered' AND a.confirmation_status='confirmed'
JOIN public.tournament_participants b ON b.id=p.player_two_id AND b.status='registered' AND b.confirmation_status='confirmed'
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
)));

CREATE OR REPLACE FUNCTION public.event_tournament_pair_payment_status(p_event_id uuid)
RETURNS TABLE(pair_id uuid,player_one_id uuid,player_two_id uuid,player_one_payment_status text,player_two_payment_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  RETURN QUERY SELECT pair.id,pair.player_one_id,pair.player_two_id,one.payment_status,two.payment_status
  FROM public.tournament_pairs pair
  JOIN public.tournament_participants one ON one.id=pair.player_one_id
  JOIN public.tournament_participants two ON two.id=pair.player_two_id
  WHERE pair.event_id=p_event_id AND pair.status='active'
    AND one.status='registered' AND two.status='registered'
    AND one.confirmation_status='confirmed' AND two.confirmation_status='confirmed'
    AND (one.user_id=auth.uid() OR two.user_id=auth.uid());
END; $$;
REVOKE ALL ON FUNCTION public.event_tournament_pair_payment_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_pair_payment_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_unconfirmed_tournament_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.payment_status='paid' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
    AND NEW.confirmation_status<>'confirmed' THEN
    RAISE EXCEPTION 'Both tournament partners must confirm before payment';
  END IF;
  IF NEW.payment_status='paid' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
    AND EXISTS (
      SELECT 1 FROM public.tournament_pairs pair
      JOIN public.tournament_participants partner
        ON partner.id=CASE WHEN pair.player_one_id=NEW.id THEN pair.player_two_id ELSE pair.player_one_id END
      WHERE pair.event_id=NEW.event_id AND pair.status='active'
        AND NEW.id IN (pair.player_one_id,pair.player_two_id)
        AND (partner.status<>'registered' OR partner.confirmation_status<>'confirmed')
    ) THEN
    RAISE EXCEPTION 'Both tournament partners must confirm before payment';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS a_prevent_unconfirmed_tournament_payment ON public.tournament_participants;
CREATE TRIGGER a_prevent_unconfirmed_tournament_payment
BEFORE UPDATE OF payment_status ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.prevent_unconfirmed_tournament_payment();

CREATE OR REPLACE FUNCTION public.withdraw_tournament_entry(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.tournament_participants%rowtype; v_partner public.tournament_participants%rowtype;
  v_event public.events%rowtype; v_pair public.tournament_pairs%rowtype; v_partner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to withdraw this entry'; END IF;
  SELECT * INTO v_entry FROM public.tournament_participants
    WHERE id=p_participant_id AND user_id=auth.uid() AND status='registered' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered entry not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_entry.event_id;
  IF now()>=coalesce(v_event.registration_closes_at,v_event.starts_at) THEN RAISE EXCEPTION 'The withdrawal cutoff has passed'; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs WHERE event_id=v_entry.event_id AND status='active'
    AND p_participant_id IN (player_one_id,player_two_id) FOR UPDATE;
  IF FOUND THEN
    v_partner_id:=CASE WHEN v_pair.player_one_id=v_entry.id THEN v_pair.player_two_id ELSE v_pair.player_one_id END;
    SELECT * INTO v_partner FROM public.tournament_participants WHERE id=v_partner_id FOR UPDATE;
    IF v_entry.confirmation_status='confirmed' AND v_partner.confirmation_status='confirmed'
      AND (v_entry.payment_status='paid' OR v_partner.payment_status='paid'
        OR (v_entry.payment_status='not_required' AND v_partner.payment_status='not_required')) THEN
      UPDATE public.tournament_participants SET status='withdrawn',updated_at=now()
        WHERE id IN (v_entry.id,v_partner.id) AND status IN ('registered','provisional');
      UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
      RETURN;
    END IF;
    UPDATE public.tournament_pairs SET status='withdrawn' WHERE id=v_pair.id;
    IF v_partner.confirmation_status='pending' THEN
      UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_partner.id;
    END IF;
  END IF;
  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now() WHERE id=v_entry.id;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_tournament_entry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.withdraw_tournament_entry(uuid) TO authenticated;

COMMIT;
