DROP POLICY IF EXISTS "Captains read their own match lineups"
  ON public.tournament_match_players;

CREATE POLICY "Captains read their own match lineups"
  ON public.tournament_match_players
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournament_matches AS match
      JOIN public.tournament_teams AS team
        ON team.id = tournament_match_players.team_id
       AND team.event_id = match.event_id
       AND team.captain_user_id = (SELECT auth.uid())
      WHERE match.id = tournament_match_players.match_id
        AND team.id = CASE
          WHEN tournament_match_players.side = 1 THEN match.team_one_id
          ELSE match.team_two_id
        END
    )
  );

GRANT SELECT ON public.tournament_match_players TO authenticated;
