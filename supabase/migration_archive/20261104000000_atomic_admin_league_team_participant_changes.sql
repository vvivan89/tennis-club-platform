-- Keep a fixed League team together when an event manager removes or restores it.

CREATE OR REPLACE FUNCTION public.admin_withdraw_league_event_team(p_participant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_pair record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_event_manager() THEN
    RAISE EXCEPTION 'Event manager access required';
  END IF;

  SELECT pair.id,pair.event_id,pair.player_one_id,pair.player_two_id
    INTO v_pair
  FROM public.tournament_participants selected
  JOIN public.tournament_pairs pair ON pair.event_id=selected.event_id
    AND pair.status='active'
    AND pair.league_team_id IS NOT NULL
    AND selected.id IN (pair.player_one_id,pair.player_two_id)
  JOIN public.events event ON event.id=pair.event_id
  JOIN public.social_doubles_ladders league ON league.id=event.social_doubles_ladder_id
    AND league.competition_type='league'
  WHERE selected.id=p_participant_id
    AND event.event_type='tournament'
    AND event.tournament_format='doubles'
    AND (public.is_admin() OR event.organizer_id=v_actor OR event.created_by=v_actor)
  FOR UPDATE OF pair;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active fixed League team registration not found';
  END IF;

  UPDATE public.tournament_participants
  SET status='withdrawn',updated_at=now()
  WHERE id IN (v_pair.player_one_id,v_pair.player_two_id)
    AND status<>'withdrawn';

  UPDATE public.tournament_pairs
  SET status='withdrawn'
  WHERE id=v_pair.id AND status='active';

  WITH cancelled_matches AS (
    UPDATE public.tournament_matches
    SET status='cancelled',updated_at=now()
    WHERE event_id=v_pair.event_id
      AND status NOT IN ('completed','cancelled')
      AND (pair_one_id=v_pair.id OR pair_two_id=v_pair.id)
    RETURNING id
  )
  DELETE FROM public.tournament_match_players players
  USING cancelled_matches cancelled
  WHERE players.match_id=cancelled.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_withdraw_league_event_team(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_league_event_team(uuid) TO authenticated;


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
  v_stale_pair_ids uuid[];
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

  SELECT * INTO v_team
  FROM public.league_teams team
  WHERE team.league_id=v_league.id
    AND team.status='active'
    AND p_member_id IN (team.player_one_id,team.player_two_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No confirmed League team was found for this member';
  END IF;

  SELECT * INTO v_profile_one FROM public.profiles WHERE id=v_team.player_one_id;
  SELECT * INTO v_profile_two FROM public.profiles WHERE id=v_team.player_two_id;
  IF v_profile_one.application_status<>'approved' OR v_profile_two.application_status<>'approved'
     OR NOT public.has_active_paid_membership(v_team.player_one_id)
     OR NOT public.has_active_paid_membership(v_team.player_two_id) THEN
    RAISE EXCEPTION 'Both League players need approved profiles and active paid memberships';
  END IF;

  -- Repair older partial withdrawals before allowing a manager to register the pair again.
  IF v_manager THEN
    SELECT array_agg(stale.id) INTO v_stale_pair_ids
    FROM (
      SELECT pair.id
      FROM public.tournament_pairs pair
      JOIN public.tournament_participants one ON one.id=pair.player_one_id
      JOIN public.tournament_participants two ON two.id=pair.player_two_id
      WHERE pair.event_id=p_event_id
        AND pair.league_team_id=v_team.id
        AND pair.status='active'
        AND (
          one.status<>'registered'
          OR two.status<>'registered'
          OR NOT (
            (one.user_id=v_team.player_one_id AND two.user_id=v_team.player_two_id)
            OR (one.user_id=v_team.player_two_id AND two.user_id=v_team.player_one_id)
          )
        )
      FOR UPDATE OF pair
    ) stale;

    IF coalesce(cardinality(v_stale_pair_ids),0)>0 THEN
      UPDATE public.tournament_participants participant
      SET status='withdrawn',updated_at=now()
      WHERE participant.id IN (
        SELECT pair.player_one_id
        FROM public.tournament_pairs pair
        WHERE pair.id=ANY(v_stale_pair_ids)
        UNION
        SELECT pair.player_two_id
        FROM public.tournament_pairs pair
        WHERE pair.id=ANY(v_stale_pair_ids)
      )
        AND participant.status<>'withdrawn';

      UPDATE public.tournament_pairs
      SET status='withdrawn'
      WHERE id=ANY(v_stale_pair_ids) AND status='active';

      WITH cancelled_matches AS (
        UPDATE public.tournament_matches
        SET status='cancelled',updated_at=now()
        WHERE event_id=p_event_id
          AND status NOT IN ('completed','cancelled')
          AND (pair_one_id=ANY(v_stale_pair_ids) OR pair_two_id=ANY(v_stale_pair_ids))
        RETURNING id
      )
      DELETE FROM public.tournament_match_players players
      USING cancelled_matches cancelled
      WHERE players.match_id=cancelled.id;
    END IF;
  END IF;

  v_category := CASE WHEN v_league.gender='male' THEN 'men' ELSE 'women' END;
  v_amount := greatest(coalesce(v_event.price_cents,0),0);
  SELECT pair.id,
    CASE WHEN one.user_id=v_team.player_one_id THEN one.id ELSE two.id END,
    CASE WHEN one.user_id=v_team.player_two_id THEN one.id ELSE two.id END
    INTO v_pair_id,v_one_participant,v_two_participant
  FROM public.tournament_pairs pair
  JOIN public.tournament_participants one ON one.id=pair.player_one_id
  JOIN public.tournament_participants two ON two.id=pair.player_two_id
  WHERE pair.event_id=p_event_id AND pair.league_team_id=v_team.id AND pair.status='active'
    AND one.status='registered' AND two.status='registered'
    AND ((one.user_id=v_team.player_one_id AND two.user_id=v_team.player_two_id)
      OR (one.user_id=v_team.player_two_id AND two.user_id=v_team.player_one_id));
  IF FOUND THEN
    RETURN jsonb_build_object('participantId',v_one_participant,'partnerParticipantId',v_two_participant,
      'pairId',v_pair_id,'amountCents',0,'paymentStatus','paid','alreadyRegistered',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants participant WHERE participant.event_id=p_event_id
       AND participant.user_id IN (v_team.player_one_id,v_team.player_two_id) AND participant.status='registered') THEN
    RAISE EXCEPTION 'League team has an incomplete registration; contact the event organizer';
  END IF;
  IF NOT v_manager AND (SELECT count(*) FROM public.tournament_participants participant
      WHERE participant.event_id=p_event_id AND participant.status='registered')+2>v_event.capacity THEN
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
END;
$$;

REVOKE ALL ON FUNCTION public.register_league_event_team(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_league_event_team(uuid,uuid) TO authenticated;
