-- Account creation is independent of membership applications. Existing pending
-- applications remain pending; event-only accounts are not treated as applicants.
ALTER TABLE public.profiles
  ALTER COLUMN application_status SET DEFAULT 'not_applied';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_application_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_application_status_check
  CHECK (application_status IN ('not_applied', 'pending', 'approved', 'dismissed'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS application_submitted_at timestamptz;

UPDATE public.profiles
SET application_submitted_at = created_at
WHERE application_status = 'pending' AND application_submitted_at IS NULL;

UPDATE public.profiles
SET application_status = 'not_applied'
WHERE account_kind = 'event_guest' AND application_status = 'pending';

CREATE OR REPLACE FUNCTION public.prevent_self_application_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) = OLD.id
    AND NEW.application_status IS DISTINCT FROM OLD.application_status
    AND NOT (
      NEW.application_status = 'pending'
      AND OLD.application_status IN ('not_applied', 'dismissed')
    ) THEN
    RAISE EXCEPTION 'Only administrators can process an application.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_membership_application(p_comment text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to apply for membership.'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your profile could not be found.'; END IF;
  IF v_profile.application_status NOT IN ('not_applied', 'dismissed') THEN
    RAISE EXCEPTION 'Your membership application is already under review or approved.';
  END IF;
  IF nullif(btrim(v_profile.full_name), '') IS NULL
    OR nullif(btrim(v_profile.phone), '') IS NULL
    OR v_profile.date_of_birth IS NULL
    OR v_profile.gender IS NULL
    OR v_profile.tennis_skill_level IS NULL THEN
    RAISE EXCEPTION 'Complete your name, phone, birthday, gender, and tennis skill rating before applying.';
  END IF;
  UPDATE public.profiles
  SET application_status = 'pending',
      application_comment = left(btrim(coalesce(p_comment, '')), 3000),
      application_submitted_at = now(),
      updated_at = now()
  WHERE id = v_user;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_membership_application(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_membership_application(text) TO authenticated;

-- Normal signups get full profiles but do not automatically enter the application queue.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_guest boolean := new.raw_user_meta_data->>'account_kind' = 'event_guest';
  v_gender text := nullif(new.raw_user_meta_data->>'gender', '');
  v_date_text text := nullif(new.raw_user_meta_data->>'date_of_birth', '');
  v_date_of_birth date;
BEGIN
  IF v_date_text IS NOT NULL THEN
    IF v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Date of birth must use YYYY-MM-DD format.';
    END IF;
    v_date_of_birth := v_date_text::date;
    IF to_char(v_date_of_birth, 'YYYY-MM-DD') <> v_date_text OR v_date_of_birth > current_date THEN
      RAISE EXCEPTION 'Enter a valid date of birth.';
    END IF;
  END IF;
  IF NOT v_event_guest THEN
    IF nullif(btrim(new.raw_user_meta_data->>'full_name'), '') IS NULL THEN
      RAISE EXCEPTION 'A full name is required to create an account.';
    END IF;
    IF coalesce(new.raw_user_meta_data->>'tennis_skill_level', '') NOT IN
      ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') THEN
      RAISE EXCEPTION 'A valid tennis skill rating is required to create an account.';
    END IF;
    IF nullif(btrim(new.raw_user_meta_data->>'phone'), '') IS NULL THEN
      RAISE EXCEPTION 'A phone number is required to create an account.';
    END IF;
    IF v_date_of_birth IS NULL THEN RAISE EXCEPTION 'A date of birth is required to create an account.'; END IF;
    IF coalesce(v_gender, '') NOT IN ('male','female','other','prefer_not_to_say') THEN
      RAISE EXCEPTION 'A valid gender is required to create an account.';
    END IF;
  END IF;
  INSERT INTO public.profiles(
    id,email,full_name,phone,tennis_skill_level,account_kind,gender,date_of_birth,application_comment
  ) VALUES (
    new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),
    CASE WHEN v_event_guest THEN '' ELSE trim(new.raw_user_meta_data->>'phone') END,
    CASE WHEN v_event_guest THEN NULL ELSE new.raw_user_meta_data->>'tennis_skill_level' END,
    CASE WHEN v_event_guest THEN 'event_guest' ELSE 'member' END,
    CASE WHEN v_event_guest THEN NULL ELSE v_gender END,
    CASE WHEN v_event_guest THEN NULL ELSE v_date_of_birth END,
    ''
  );
  RETURN new;
END;
$$;

-- An unapproved profile can use the existing event-guest registration flow. The
-- profile and tournament participant keep the same auth user ID and verified email.
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
  IF v_auth_email IS NULL OR v_auth_confirmed IS NULL THEN RAISE EXCEPTION 'Verify your email before registering'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user
    AND (account_kind='event_guest' OR (account_kind='member' AND application_status<>'approved'));
  IF NOT FOUND OR lower(v_profile.email)<>lower(v_auth_email) THEN
    RAISE EXCEPTION 'Verified non-member registration session required';
  END IF;
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
    IF v_partner.account_kind='member' AND v_partner.application_status='approved' THEN
      v_partner_user:=v_partner.id; v_partner_member:=true;
    ELSIF v_partner.account_kind='event_guest' OR (v_partner.account_kind='member' AND v_partner.application_status<>'approved') THEN
      v_partner_user:=v_partner.id;
    ELSE RAISE EXCEPTION 'Partner email belongs to an account that must sign in through member login'; END IF;
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
END;
$$;
REVOKE ALL ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_event_guest_tournament_entry(uuid,text,text,text,text,numeric,text,text,text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_event_guest_registration_details(
  p_participant_id uuid,p_display_name text,p_phone text,p_gender text,p_tennis_skill_level numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry public.tournament_participants%rowtype; v_event public.events%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid()
      AND (account_kind='event_guest' OR (account_kind='member' AND application_status<>'approved'))
  ) THEN RAISE EXCEPTION 'Verified non-member registration session required'; END IF;
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
END;
$$;
REVOKE ALL ON FUNCTION public.update_event_guest_registration_details(uuid,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_event_guest_registration_details(uuid,text,text,text,numeric) TO authenticated;

-- Show linked non-member profiles as public event entrants, not club members.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  coalesce(profile.application_status='approved' AND profile.account_kind='member',false) AS is_member,
  false AS captain_requested,profile.avatar_url,
  (coalesce(profile.show_birthday_emoji,false) AND profile.date_of_birth IS NOT NULL
    AND to_char(profile.date_of_birth,'MM-DD')=to_char((now() AT TIME ZONE 'America/Vancouver')::date,'MM-DD'))
    AS birthday_emoji_visible,p.user_id
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered' AND p.confirmation_status='confirmed'
  AND (p.user_id IS NULL OR profile.account_kind IN ('member','event_guest'))
  AND (e.tournament_details_public=true OR EXISTS (
    SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
      AND viewer.application_status='approved' AND viewer.account_kind='member'
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
      AND own.user_id=auth.uid() AND own.status='registered'
  ));
GRANT SELECT ON public.tournament_public_participants TO anon,authenticated;

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT pair.id,pair.event_id,pair.category,pair.player_one_id,pair.player_two_id,
  pair.group_number,pair.seed,pair.status,a.display_name AS player_one_name,b.display_name AS player_two_name,
  coalesce(a.tennis_skill_level::text,profile_a.tennis_skill_level) AS player_one_skill_level,
  coalesce(b.tennis_skill_level::text,profile_b.tennis_skill_level) AS player_two_skill_level
FROM public.tournament_pairs pair
JOIN public.tournament_participants a ON a.id=pair.player_one_id AND a.status='registered' AND a.confirmation_status='confirmed'
JOIN public.tournament_participants b ON b.id=pair.player_two_id AND b.status='registered' AND b.confirmation_status='confirmed'
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=pair.event_id
WHERE e.status='published'
  AND (a.user_id IS NULL OR profile_a.account_kind IN ('member','event_guest'))
  AND (b.user_id IS NULL OR profile_b.account_kind IN ('member','event_guest'))
  AND (e.tournament_details_public=true OR EXISTS (
    SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
      AND viewer.application_status='approved' AND viewer.account_kind='member'
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
      AND own.user_id=auth.uid() AND own.status='registered'
  ));
GRANT SELECT ON public.tournament_public_pairs TO anon,authenticated;

CREATE OR REPLACE VIEW public.tournament_public_matches AS
SELECT m.id,m.event_id,m.category,m.phase,m.group_number,m.round_number,m.match_number,
  m.pair_one_id,m.pair_two_id,m.team_one_id,m.team_two_id,m.scheduled_at,m.court_number,
  m.score_sets,m.winner_side,m.team_points_one,m.team_points_two,m.status,m.notes,
  team_one.name AS team_one_name,team_two.name AS team_two_name,
  CASE WHEN public.is_event_manager() OR m.team_one_lineup_public
      OR now()>=coalesce(m.scheduled_at,e.starts_at) OR EXISTS (
        SELECT 1 FROM public.tournament_participants own
        WHERE own.event_id=m.event_id AND own.team_id=m.team_one_id AND own.user_id=auth.uid()
          AND own.status='registered' AND own.confirmation_status='confirmed'
      ) THEN coalesce(side_one.players,pair_one.player_one_name || ' + ' || pair_one.player_two_name)
    ELSE coalesce(pair_one.player_one_name || ' + ' || pair_one.player_two_name,'') END AS player_one_name,
  NULL::text AS player_two_name,
  CASE WHEN public.is_event_manager() OR m.team_two_lineup_public
      OR now()>=coalesce(m.scheduled_at,e.starts_at) OR EXISTS (
        SELECT 1 FROM public.tournament_participants own
        WHERE own.event_id=m.event_id AND own.team_id=m.team_two_id AND own.user_id=auth.uid()
          AND own.status='registered' AND own.confirmation_status='confirmed'
      ) THEN coalesce(side_two.players,pair_two.player_one_name || ' + ' || pair_two.player_two_name)
    ELSE coalesce(pair_two.player_one_name || ' + ' || pair_two.player_two_name,'') END AS opponent_one_name,
  NULL::text AS opponent_two_name,m.team_one_lineup_public,m.team_two_lineup_public
FROM public.tournament_matches m
JOIN public.events e ON e.id=m.event_id AND e.status='published'
LEFT JOIN public.tournament_teams team_one ON team_one.id=m.team_one_id
LEFT JOIN public.tournament_teams team_two ON team_two.id=m.team_two_id
LEFT JOIN public.tournament_public_pairs pair_one ON pair_one.id=m.pair_one_id
LEFT JOIN public.tournament_public_pairs pair_two ON pair_two.id=m.pair_two_id
LEFT JOIN LATERAL (
  SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players
  FROM public.tournament_match_players mp
  JOIN public.tournament_participants p ON p.id=mp.participant_id
  LEFT JOIN public.profiles profile ON profile.id=p.user_id
  WHERE mp.match_id=m.id AND mp.side=1
    AND (p.user_id IS NULL OR profile.account_kind IN ('member','event_guest'))
) side_one ON true
LEFT JOIN LATERAL (
  SELECT string_agg(p.display_name,' + ' ORDER BY p.display_name) AS players
  FROM public.tournament_match_players mp
  JOIN public.tournament_participants p ON p.id=mp.participant_id
  LEFT JOIN public.profiles profile ON profile.id=p.user_id
  WHERE mp.match_id=m.id AND mp.side=2
    AND (p.user_id IS NULL OR profile.account_kind IN ('member','event_guest'))
) side_two ON true
WHERE e.tournament_details_public=true OR EXISTS (
    SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
      AND viewer.application_status='approved' AND viewer.account_kind='member'
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
      AND own.user_id=auth.uid() AND own.status='registered'
  );
GRANT SELECT ON public.tournament_public_matches TO anon,authenticated;

