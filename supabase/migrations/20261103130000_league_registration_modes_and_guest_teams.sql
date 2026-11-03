-- League events honor their configured individual/pair registration modes.
-- A pair becomes a fixed League team only after both players confirm.

CREATE OR REPLACE FUNCTION public.register_league_single_event_entry(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_league public.social_doubles_ladders%rowtype;
  v_profile public.profiles%rowtype;
  v_config jsonb;
  v_category text;
  v_participant_id uuid;
  v_amount integer;
  v_payment_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in with an approved member account to register for a League event'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament';
  IF NOT FOUND OR v_event.social_doubles_ladder_id IS NULL THEN RAISE EXCEPTION 'League event was not found'; END IF;
  SELECT * INTO v_league FROM public.social_doubles_ladders
    WHERE id=v_event.social_doubles_ladder_id AND competition_type='league';
  IF NOT FOUND OR v_event.tournament_format<>'doubles' THEN RAISE EXCEPTION 'This is not a League doubles event'; END IF;
  v_config:=coalesce(v_event.tournament_config,'{}'::jsonb);
  IF coalesce(v_config->>'registration_mode','both')='doubles' THEN
    RAISE EXCEPTION 'This League event requires registration with a partner';
  END IF;
  IF v_event.status<>'published' OR now()<v_event.registration_opens_at
     OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at)
     OR now()>=v_event.starts_at THEN RAISE EXCEPTION 'League event registration is closed'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user AND application_status='approved'
    AND account_kind='member';
  IF NOT FOUND OR NOT public.has_active_paid_membership(v_user) THEN
    RAISE EXCEPTION 'An approved profile and active paid membership are required for League registration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_teams team WHERE team.league_id=v_league.id
       AND team.status='active' AND v_user IN (team.player_one_id,team.player_two_id)) THEN
    RAISE EXCEPTION 'You have a confirmed League partner. Register your team instead';
  END IF;
  v_category := CASE WHEN v_league.gender='male' THEN 'men' ELSE 'women' END;
  IF v_profile.gender IS NOT NULL AND v_profile.gender<>(CASE WHEN v_category='men' THEN 'male' ELSE 'female' END) THEN
    RAISE EXCEPTION 'Your profile gender does not match this League category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.event_id=p_event_id
       AND p.user_id=v_user AND p.category=v_category AND p.status='registered') THEN
    RAISE EXCEPTION 'You are already registered for this League event';
  END IF;
  IF (SELECT count(*) FROM public.tournament_participants p
      WHERE p.event_id=p_event_id AND p.status='registered')+1>v_event.capacity THEN
    RAISE EXCEPTION 'League event registration is full';
  END IF;
  v_amount := greatest(coalesce(v_event.price_cents,0),0);
  INSERT INTO public.tournament_participants(
    event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status
  ) VALUES (
    p_event_id,v_user,v_category,coalesce(nullif(v_profile.full_name,''),v_profile.email),
    v_profile.email,v_profile.phone,v_profile.gender,v_amount,
    CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END
  ) RETURNING id,amount_cents,payment_status
    INTO v_participant_id,v_amount,v_payment_status;
  RETURN jsonb_build_object('participantId',v_participant_id,'amountCents',v_amount,
    'paymentStatus',v_payment_status,'singleRegistration',true);
END; $$;
REVOKE ALL ON FUNCTION public.register_league_single_event_entry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_league_single_event_entry(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_league_event_team(p_event_id uuid,p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.events%rowtype;
  v_league public.social_doubles_ladders%rowtype;
  v_team public.league_teams%rowtype;
  v_profile_one public.profiles%rowtype;
  v_profile_two public.profiles%rowtype;
  v_category text;
  v_amount integer;
  v_one_participant uuid;
  v_two_participant uuid;
  v_pair_id uuid;
  v_manager boolean;
  v_one_eligible boolean;
  v_two_eligible boolean;
BEGIN
  IF v_actor IS NULL OR p_member_id IS NULL THEN RAISE EXCEPTION 'Sign in to register a League team'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='tournament';
  IF NOT FOUND OR v_event.social_doubles_ladder_id IS NULL THEN RAISE EXCEPTION 'League event was not found'; END IF;
  SELECT * INTO v_league FROM public.social_doubles_ladders
    WHERE id=v_event.social_doubles_ladder_id AND competition_type='league';
  IF NOT FOUND OR v_event.tournament_format<>'doubles' THEN RAISE EXCEPTION 'This is not a League doubles event'; END IF;
  v_manager := public.is_event_manager() AND EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND (public.is_admin() OR e.organizer_id=v_actor OR e.created_by=v_actor)
  );
  IF v_actor<>p_member_id AND NOT v_manager THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF v_event.status<>'published' THEN RAISE EXCEPTION 'League event registration is unavailable'; END IF;
  IF NOT v_manager AND (now()<v_event.registration_opens_at
      OR (v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at)
      OR now()>=v_event.starts_at) THEN RAISE EXCEPTION 'League event registration is closed'; END IF;

  SELECT * INTO v_team FROM public.league_teams t
    WHERE t.league_id=v_league.id AND t.status='active'
      AND p_member_id IN (t.player_one_id,t.player_two_id)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed League team was found for this member'; END IF;
  SELECT * INTO v_profile_one FROM public.profiles WHERE id=v_team.player_one_id;
  SELECT * INTO v_profile_two FROM public.profiles WHERE id=v_team.player_two_id;
  v_one_eligible := v_profile_one.account_kind='member' AND v_profile_one.application_status='approved'
    AND public.has_active_paid_membership(v_team.player_one_id);
  v_two_eligible := v_profile_two.account_kind='member' AND v_profile_two.application_status='approved'
    AND public.has_active_paid_membership(v_team.player_two_id);
  IF v_event.allow_non_member_registration THEN
    v_one_eligible := v_one_eligible OR v_profile_one.account_kind='event_guest';
    v_two_eligible := v_two_eligible OR v_profile_two.account_kind='event_guest';
  END IF;
  IF NOT v_one_eligible OR NOT v_two_eligible THEN
    RAISE EXCEPTION 'League players need approved paid memberships or confirmed event-only accounts accepted by this event';
  END IF;

  v_category := CASE WHEN v_league.gender='male' THEN 'men' ELSE 'women' END;
  v_amount := greatest(coalesce(v_event.price_cents,0),0);
  SELECT pair.id,
    CASE WHEN p1.user_id=v_team.player_one_id THEN p1.id ELSE p2.id END,
    CASE WHEN p1.user_id=v_team.player_two_id THEN p1.id ELSE p2.id END
    INTO v_pair_id,v_one_participant,v_two_participant
  FROM public.tournament_pairs pair
  JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id
  JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id
  WHERE pair.event_id=p_event_id AND pair.league_team_id=v_team.id AND pair.status='active'
    AND p1.status='registered' AND p2.status='registered'
    AND ((p1.user_id=v_team.player_one_id AND p2.user_id=v_team.player_two_id)
      OR (p1.user_id=v_team.player_two_id AND p2.user_id=v_team.player_one_id));
  IF FOUND THEN
    RETURN jsonb_build_object('participantId',v_one_participant,'partnerParticipantId',v_two_participant,
      'pairId',v_pair_id,'amountCents',0,'paymentStatus','paid','alreadyRegistered',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.event_id=p_event_id
       AND p.user_id IN (v_team.player_one_id,v_team.player_two_id) AND p.status='registered') THEN
    RAISE EXCEPTION 'League team has an incomplete registration; contact the event organizer';
  END IF;
  IF NOT v_manager AND (SELECT count(*) FROM public.tournament_participants p
      WHERE p.event_id=p_event_id AND p.status='registered')+2>v_event.capacity THEN
    RAISE EXCEPTION 'League event does not have room for both players';
  END IF;

  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
  VALUES(p_event_id,v_team.player_one_id,v_category,
    coalesce(nullif(v_profile_one.full_name,''),v_profile_one.email),v_profile_one.email,v_profile_one.phone,
    v_profile_one.gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_one_participant;
  INSERT INTO public.tournament_participants(event_id,user_id,category,display_name,email,phone,gender,amount_cents,payment_status)
  VALUES(p_event_id,v_team.player_two_id,v_category,
    coalesce(nullif(v_profile_two.full_name,''),v_profile_two.email),v_profile_two.email,v_profile_two.phone,
    v_profile_two.gender,v_amount,CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_two_participant;
  INSERT INTO public.tournament_pairs(event_id,category,player_one_id,player_two_id,league_team_id)
  VALUES(p_event_id,v_category,v_one_participant,v_two_participant,v_team.id)
  RETURNING id INTO v_pair_id;
  RETURN jsonb_build_object('participantId',v_one_participant,'partnerParticipantId',v_two_participant,
    'pairId',v_pair_id,'amountCents',v_amount,'paymentStatus',CASE WHEN v_amount=0 THEN 'not_required' ELSE 'pending' END,
    'alreadyRegistered',false);
END; $$;
REVOKE ALL ON FUNCTION public.register_league_event_team(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_league_event_team(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS "Approved members view league teams" ON public.league_teams;
CREATE POLICY "Members and their event guests view league teams" ON public.league_teams
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.account_kind='event_guest'
    AND auth.uid() IN (league_teams.player_one_id,league_teams.player_two_id))
);

CREATE OR REPLACE FUNCTION public.fix_confirmed_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_pair public.tournament_pairs%rowtype;
  v_one public.tournament_participants%rowtype;
  v_two public.tournament_participants%rowtype;
  v_existing_one public.league_teams%rowtype;
  v_existing_two public.league_teams%rowtype;
  v_team_id uuid;
  v_event_id uuid;
  v_participant_id uuid;
BEGIN
  IF TG_TABLE_NAME='tournament_participants' THEN
    IF NEW.user_id IS NULL OR NEW.status<>'registered' OR NEW.confirmation_status<>'confirmed' THEN RETURN NEW; END IF;
    v_event_id:=NEW.event_id;
    v_participant_id:=NEW.id;
  ELSE
    IF NEW.status<>'active' OR NEW.league_team_id IS NOT NULL THEN RETURN NEW; END IF;
    v_event_id:=NEW.event_id;
    v_participant_id:=NEW.player_one_id;
  END IF;
  SELECT e.* INTO v_event FROM public.events e
    WHERE e.id=v_event_id AND e.event_type='tournament' AND e.social_doubles_ladder_id IS NOT NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_doubles_ladders l
      WHERE l.id=v_event.social_doubles_ladder_id AND l.competition_type='league') THEN RETURN NEW; END IF;
  SELECT * INTO v_pair FROM public.tournament_pairs p WHERE p.event_id=v_event_id AND p.status='active'
    AND v_participant_id IN (p.player_one_id,p.player_two_id) FOR UPDATE;
  IF NOT FOUND OR v_pair.league_team_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_one FROM public.tournament_participants WHERE id=v_pair.player_one_id FOR UPDATE;
  SELECT * INTO v_two FROM public.tournament_participants WHERE id=v_pair.player_two_id FOR UPDATE;
  IF v_one.user_id IS NULL OR v_two.user_id IS NULL
     OR v_one.status<>'registered' OR v_two.status<>'registered'
     OR v_one.confirmation_status<>'confirmed' OR v_two.confirmation_status<>'confirmed' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (v_one.user_id,v_two.user_id)
      AND NOT (p.account_kind='member' AND p.application_status='approved')
      AND NOT (v_event.allow_non_member_registration AND p.account_kind='event_guest')) THEN
    RAISE EXCEPTION 'League pair must contain approved members or confirmed event-only registrants';
  END IF;

  SELECT * INTO v_existing_one FROM public.league_teams t WHERE t.league_id=v_event.social_doubles_ladder_id
    AND t.status='active' AND v_one.user_id IN (t.player_one_id,t.player_two_id) FOR UPDATE;
  SELECT * INTO v_existing_two FROM public.league_teams t WHERE t.league_id=v_event.social_doubles_ladder_id
    AND t.status='active' AND v_two.user_id IN (t.player_one_id,t.player_two_id) FOR UPDATE;
  IF v_existing_one.id IS NOT NULL AND v_existing_two.id IS NOT NULL
     AND v_existing_one.id IS DISTINCT FROM v_existing_two.id THEN
    RAISE EXCEPTION 'League partners are fixed after team confirmation';
  END IF;
  IF v_existing_one.id IS NOT NULL OR v_existing_two.id IS NOT NULL THEN
    v_team_id:=coalesce(v_existing_one.id,v_existing_two.id);
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=v_team_id
      AND ((t.player_one_id=v_one.user_id AND t.player_two_id=v_two.user_id)
        OR (t.player_one_id=v_two.user_id AND t.player_two_id=v_one.user_id))) THEN
      RAISE EXCEPTION 'League partners are fixed after team confirmation';
    END IF;
  ELSE
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id,status,confirmed_at)
    VALUES(v_event.social_doubles_ladder_id,v_one.user_id,v_two.user_id,'active',now())
    RETURNING id INTO v_team_id;
  END IF;
  UPDATE public.tournament_pairs SET league_team_id=v_team_id WHERE id=v_pair.id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS fix_confirmed_league_tournament_pair ON public.tournament_participants;
CREATE TRIGGER fix_confirmed_league_tournament_pair
AFTER UPDATE OF user_id,status,confirmation_status ON public.tournament_participants
FOR EACH ROW EXECUTE FUNCTION public.fix_confirmed_league_tournament_pair();
DROP TRIGGER IF EXISTS fix_confirmed_league_tournament_pair_insert ON public.tournament_pairs;
CREATE TRIGGER fix_confirmed_league_tournament_pair_insert
AFTER INSERT OR UPDATE OF player_one_id,player_two_id,status,league_team_id ON public.tournament_pairs
FOR EACH ROW EXECUTE FUNCTION public.fix_confirmed_league_tournament_pair();
