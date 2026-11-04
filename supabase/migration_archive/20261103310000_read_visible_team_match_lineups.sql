CREATE OR REPLACE FUNCTION public.event_tournament_visible_match_lineups(p_event_id uuid)
RETURNS TABLE(match_id uuid, participant_id uuid, side smallint, team_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT players.match_id, players.participant_id, players.side, players.team_id
  FROM public.tournament_match_players AS players
  JOIN public.tournament_matches AS match ON match.id = players.match_id
  JOIN public.tournament_teams AS team ON team.id = players.team_id
  JOIN public.events AS event ON event.id = match.event_id
  WHERE match.event_id = p_event_id
    AND (event.status = 'published' OR public.is_event_manager())
    AND (
      public.is_event_manager()
      OR team.captain_user_id = (SELECT auth.uid())
      OR (players.side = 1 AND match.team_one_lineup_public)
      OR (players.side = 2 AND match.team_two_lineup_public)
    );
$$;

REVOKE ALL ON FUNCTION public.event_tournament_visible_match_lineups(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_tournament_visible_match_lineups(uuid)
  TO authenticated;
