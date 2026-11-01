-- Withdraw both participants and their League pair as one operation.
BEGIN;

CREATE OR REPLACE FUNCTION public.withdraw_league_event_team(p_participant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event public.events%rowtype;
  v_pair record;
  v_team public.league_teams%rowtype;
  v_updated integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to withdraw a League team'; END IF;
  SELECT pair.id,pair.league_team_id,pair.player_one_id,pair.player_two_id,
    p1.user_id AS player_one_user_id,p2.user_id AS player_two_user_id,p1.event_id
    INTO v_pair
  FROM public.tournament_participants selected
  JOIN public.tournament_pairs pair ON pair.event_id=selected.event_id
    AND pair.status='active' AND selected.id IN (pair.player_one_id,pair.player_two_id)
  JOIN public.tournament_participants p1 ON p1.id=pair.player_one_id AND p1.status='registered'
  JOIN public.tournament_participants p2 ON p2.id=pair.player_two_id AND p2.status='registered'
  WHERE selected.id=p_participant_id AND selected.user_id=v_actor AND selected.status='registered'
  FOR UPDATE OF pair,p1,p2;
  IF NOT FOUND OR v_pair.league_team_id IS NULL THEN RAISE EXCEPTION 'Active League team registration not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_pair.event_id;
  IF now() >= coalesce(v_event.registration_closes_at,v_event.starts_at) THEN
    RAISE EXCEPTION 'The withdrawal cutoff has passed';
  END IF;
  SELECT * INTO v_team FROM public.league_teams
    WHERE id=v_pair.league_team_id AND status='active' FOR UPDATE;
  IF NOT FOUND OR NOT (
    (v_team.player_one_id=v_pair.player_one_user_id AND v_team.player_two_id=v_pair.player_two_user_id)
    OR (v_team.player_one_id=v_pair.player_two_user_id AND v_team.player_two_id=v_pair.player_one_user_id)
  ) THEN RAISE EXCEPTION 'Confirmed League team could not be verified'; END IF;

  UPDATE public.tournament_participants SET status='withdrawn',updated_at=now()
    WHERE id IN (v_pair.player_one_id,v_pair.player_two_id) AND status='registered';
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>2 THEN RAISE EXCEPTION 'Both League players must be registered to withdraw the team'; END IF;
  UPDATE public.tournament_pairs SET status='withdrawn'
    WHERE id=v_pair.id AND status='active';
END; $$;

REVOKE ALL ON FUNCTION public.withdraw_league_event_team(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.withdraw_league_event_team(uuid) TO authenticated;

COMMIT;
