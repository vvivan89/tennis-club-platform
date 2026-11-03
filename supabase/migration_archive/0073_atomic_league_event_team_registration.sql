-- Register an established League team together and create its event pair atomically.
BEGIN;

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
  IF v_profile_one.application_status<>'approved' OR v_profile_two.application_status<>'approved'
     OR NOT public.has_active_paid_membership(v_team.player_one_id)
     OR NOT public.has_active_paid_membership(v_team.player_two_id) THEN
    RAISE EXCEPTION 'Both League players need approved profiles and active paid memberships';
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

COMMIT;
