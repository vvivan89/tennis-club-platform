-- Use active membership as the League pair eligibility rule and expose it to the admin selector.
BEGIN;

CREATE OR REPLACE FUNCTION public.validate_league_tournament_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_league uuid; v_gender text; v_one uuid; v_two uuid; v_member_team public.league_teams%rowtype;
BEGIN
  SELECT e.social_doubles_ladder_id,l.gender INTO v_league,v_gender
  FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE e.id=NEW.event_id AND e.event_type='tournament' AND e.tournament_format='doubles';
  IF v_league IS NULL THEN RETURN NEW; END IF;
  IF NEW.category <> (CASE WHEN v_gender='male' THEN 'men' ELSE 'women' END) THEN
    RAISE EXCEPTION 'League pairs must use the league gender category';
  END IF;
  SELECT p1.user_id,p2.user_id INTO v_one,v_two
  FROM public.tournament_participants p1,public.tournament_participants p2
  WHERE p1.id=NEW.player_one_id AND p2.id=NEW.player_two_id;
  IF v_one IS NULL OR v_two IS NULL THEN RAISE EXCEPTION 'League teams require two approved member accounts'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id IN (v_one,v_two)
      AND (p.application_status<>'approved' OR NOT public.has_active_paid_membership(p.id))
  ) THEN
    RAISE EXCEPTION 'League teams require players with active paid membership';
  END IF;
  SELECT * INTO v_member_team FROM public.league_teams t WHERE t.league_id=v_league AND t.status='active'
    AND (t.player_one_id IN (v_one,v_two) OR t.player_two_id IN (v_one,v_two)) LIMIT 1;
  IF FOUND THEN
    IF NOT ((v_member_team.player_one_id=v_one AND v_member_team.player_two_id=v_two) OR (v_member_team.player_one_id=v_two AND v_member_team.player_two_id=v_one)) THEN
      RAISE EXCEPTION 'League partners are fixed after the pair is created';
    END IF;
    NEW.league_team_id := v_member_team.id;
  ELSIF NEW.league_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_teams t WHERE t.id=NEW.league_team_id AND t.league_id=v_league
      AND ((t.player_one_id=v_one AND t.player_two_id=v_two) OR (t.player_one_id=v_two AND t.player_two_id=v_one))) THEN
      RAISE EXCEPTION 'League team does not match this event pair';
    END IF;
  ELSE
    INSERT INTO public.league_teams(league_id,player_one_id,player_two_id)
    VALUES(v_league,v_one,v_two) RETURNING * INTO v_member_team;
    NEW.league_team_id := v_member_team.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.league_event_pair_eligibility(p_event_id uuid)
RETURNS TABLE(participant_id uuid,eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND l.competition_type='league'
      AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  RETURN QUERY
  SELECT participant.id,
    (profile.application_status='approved' AND public.has_active_paid_membership(profile.id))
  FROM public.tournament_participants participant
  JOIN public.profiles profile ON profile.id=participant.user_id
  WHERE participant.event_id=p_event_id AND participant.status='registered';
END; $$;

REVOKE ALL ON FUNCTION public.league_event_pair_eligibility(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.league_event_pair_eligibility(uuid) TO authenticated;

COMMIT;
