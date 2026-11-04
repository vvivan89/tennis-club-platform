CREATE OR REPLACE FUNCTION public.event_tournament_match_lineup_counts(p_match_id uuid)
RETURNS TABLE(team_one_count bigint, team_two_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match public.tournament_matches%rowtype;
BEGIN
  SELECT match.* INTO v_match
  FROM public.tournament_matches AS match
  WHERE match.id = p_match_id;

  IF NOT FOUND OR (
    NOT public.is_event_manager()
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_teams AS captain_team
      WHERE captain_team.event_id = v_match.event_id
        AND captain_team.captain_user_id = (SELECT auth.uid())
        AND captain_team.id IN (v_match.team_one_id, v_match.team_two_id)
    )
  ) THEN
    RAISE EXCEPTION 'You cannot inspect lineups for this match';
  END IF;

  RETURN QUERY
  SELECT
    count(DISTINCT player.participant_id) FILTER (
      WHERE player.side = 1 AND player.team_id = v_match.team_one_id
    ),
    count(DISTINCT player.participant_id) FILTER (
      WHERE player.side = 2 AND player.team_id = v_match.team_two_id
    )
  FROM public.tournament_match_players AS player
  WHERE player.match_id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.event_tournament_match_lineup_counts(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_match_lineup_counts(uuid)
  TO authenticated;
