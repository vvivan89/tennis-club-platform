-- Require the League event to have started before any score can be entered.
BEGIN;

CREATE OR REPLACE FUNCTION public.submit_league_match_score(
  p_match_id uuid,
  p_score_one integer,
  p_score_two integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_starts_at timestamptz;
  v_status text;
  v_league_id uuid;
  v_pair_one uuid;
  v_pair_two uuid;
  v_organizer_id uuid;
  v_created_by uuid;
  v_is_manager boolean := false;
BEGIN
  IF auth.uid() IS NULL OR p_score_one IS NULL OR p_score_two IS NULL
    OR p_score_one < 0 OR p_score_two < 0 OR p_score_one = p_score_two THEN
    RAISE EXCEPTION 'Enter two different non-negative scores';
  END IF;

  SELECT e.id,e.starts_at,e.social_doubles_ladder_id,m.status,m.pair_one_id,m.pair_two_id,
         e.organizer_id,e.created_by
    INTO v_event_id,v_starts_at,v_league_id,v_status,v_pair_one,v_pair_two,
         v_organizer_id,v_created_by
  FROM public.tournament_matches m
  JOIN public.events e ON e.id=m.event_id
  JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id AND l.competition_type='league'
  WHERE m.id=p_match_id AND e.event_type='tournament' AND e.tournament_format='doubles'
    AND m.phase='round_robin' AND m.pair_one_id IS NOT NULL AND m.pair_two_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'League match not found'; END IF;
  IF v_status='cancelled' THEN RAISE EXCEPTION 'This match was cancelled'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.application_status='approved'
      AND (p.role='admin' OR (p.role='organizer' AND COALESCE(v_organizer_id,v_created_by)=auth.uid()))
  ) INTO v_is_manager;

  IF now() < v_starts_at THEN
    RAISE EXCEPTION 'Scores cannot be entered before the event start time';
  END IF;
  IF NOT v_is_manager AND now() - v_starts_at > interval '2 days' THEN
    RAISE EXCEPTION 'Scores can only be entered within two days of the event start';
  END IF;

  IF NOT v_is_manager AND NOT EXISTS (
    SELECT 1
    FROM public.tournament_pairs pair
    JOIN public.league_teams team ON team.id=pair.league_team_id
      AND team.league_id=v_league_id AND team.status='active'
    JOIN public.tournament_participants player ON player.id IN (pair.player_one_id,pair.player_two_id)
    WHERE pair.id IN (v_pair_one,v_pair_two) AND pair.event_id=v_event_id AND pair.status='active'
      AND player.user_id=auth.uid()
      AND player.user_id IN (team.player_one_id,team.player_two_id)
  ) THEN
    RAISE EXCEPTION 'Only players in these fixed League teams or approved event managers can submit the match score';
  END IF;

  UPDATE public.tournament_matches
  SET score_sets=jsonb_build_array(jsonb_build_object('one',p_score_one,'two',p_score_two)),
      winner_side=CASE WHEN p_score_one > p_score_two THEN 1 ELSE 2 END,
      status='completed',
      team_points_one=CASE WHEN p_score_one > p_score_two THEN 3 ELSE 0 END,
      team_points_two=CASE WHEN p_score_two > p_score_one THEN 3 ELSE 0 END,
      entered_by=auth.uid(),
      updated_at=now()
  WHERE id=p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_league_match_score(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_league_match_score(uuid,integer,integer) TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename='league_event_court_assignments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.league_event_court_assignments';
  END IF;
END $$;

COMMIT;
