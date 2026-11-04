CREATE OR REPLACE FUNCTION public.save_captain_team_match_result(
  p_match_id uuid,
  p_score_sets jsonb,
  p_winner_side smallint,
  p_team_points_one integer,
  p_team_points_two integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match public.tournament_matches%rowtype;
  v_event_start timestamptz;
  v_team_one_count integer;
  v_team_two_count integer;
BEGIN
  SELECT match_row.*
    INTO v_match
  FROM public.tournament_matches AS match_row
  JOIN public.events AS event ON event.id = match_row.event_id
  WHERE match_row.id = p_match_id
    AND event.tournament_format = 'team';

  SELECT event.starts_at INTO v_event_start
  FROM public.events AS event
  WHERE event.id = v_match.event_id;

  IF NOT FOUND OR v_match.status IN ('bye', 'cancelled') THEN
    RAISE EXCEPTION 'This match cannot accept a result';
  END IF;

  IF NOT public.is_event_manager() AND NOT EXISTS (
    SELECT 1
    FROM public.tournament_teams AS team
    WHERE team.event_id = v_match.event_id
      AND team.captain_user_id = (SELECT auth.uid())
      AND team.id IN (v_match.team_one_id, v_match.team_two_id)
  ) THEN
    RAISE EXCEPTION 'Only a team captain or event manager can enter this result';
  END IF;

  IF now() < coalesce(v_match.scheduled_at, v_event_start) THEN
    RAISE EXCEPTION 'A match result can only be entered after its scheduled start time';
  END IF;

  SELECT lineup.team_one_count::integer, lineup.team_two_count::integer
    INTO v_team_one_count, v_team_two_count
  FROM public.event_tournament_match_lineup_counts(p_match_id) AS lineup;

  IF v_team_one_count <> 2 OR v_team_two_count <> 2 THEN
    RAISE EXCEPTION 'Assign two players to each side of this match before recording its result so individual records remain accurate';
  END IF;

  IF p_score_sets IS NULL OR jsonb_typeof(p_score_sets) <> 'array' THEN
    RAISE EXCEPTION 'Enter a valid match score';
  END IF;
  IF jsonb_array_length(p_score_sets) = 0 OR p_winner_side IS NULL
     OR p_winner_side NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Enter a valid match score';
  END IF;

  UPDATE public.tournament_matches
  SET score_sets = p_score_sets,
      winner_side = p_winner_side,
      status = 'completed',
      team_points_one = p_team_points_one,
      team_points_two = p_team_points_two,
      entered_by = (SELECT auth.uid()),
      updated_at = now()
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_captain_team_match_result(uuid,jsonb,smallint,integer,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_captain_team_match_result(uuid,jsonb,smallint,integer,integer)
  TO authenticated;
