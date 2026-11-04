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
  v_tournament_config jsonb;
  v_scoring_template text;
  v_first_two_one integer := 0;
  v_first_two_two integer := 0;
  v_total_one integer := 0;
  v_total_two integer := 0;
  v_points_one integer := 0;
  v_points_two integer := 0;
BEGIN
  SELECT match_row.*
    INTO v_match
  FROM public.tournament_matches AS match_row
  JOIN public.events AS event ON event.id = match_row.event_id
  WHERE match_row.id = p_match_id
    AND event.tournament_format = 'team';

  SELECT event.starts_at, event.tournament_config
    INTO v_event_start, v_tournament_config
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
    INTO v_first_two_one, v_first_two_two
  FROM public.event_tournament_match_lineup_counts(p_match_id) AS lineup;

  IF v_first_two_one <> 2 OR v_first_two_two <> 2 THEN
    RAISE EXCEPTION 'Assign two players to each side of this match before recording its result so individual records remain accurate';
  END IF;

  IF p_score_sets IS NULL OR jsonb_typeof(p_score_sets) <> 'array'
     OR jsonb_array_length(p_score_sets) = 0 OR p_winner_side IS NULL
     OR p_winner_side NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Enter a valid match score';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_score_sets) AS sets(value)
    WHERE coalesce(sets.value->>'one', '') !~ '^[0-9]+$'
       OR coalesce(sets.value->>'two', '') !~ '^[0-9]+$'
       OR (sets.value->>'one')::integer = (sets.value->>'two')::integer
  ) THEN
    RAISE EXCEPTION 'Enter a valid match score';
  END IF;

  v_scoring_template := coalesce(
    v_tournament_config->'scoring_templates'->>v_match.phase,
    v_tournament_config->>'scoring_template',
    'best_of_three'
  );

  SELECT
    count(*) FILTER (
      WHERE sets.ordinality <= 2 AND (sets.value->>'one')::integer > (sets.value->>'two')::integer
    )::integer,
    count(*) FILTER (
      WHERE sets.ordinality <= 2 AND (sets.value->>'two')::integer > (sets.value->>'one')::integer
    )::integer,
    count(*) FILTER (
      WHERE (sets.value->>'one')::integer > (sets.value->>'two')::integer
    )::integer,
    count(*) FILTER (
      WHERE (sets.value->>'two')::integer > (sets.value->>'one')::integer
    )::integer
  INTO v_first_two_one, v_first_two_two, v_total_one, v_total_two
  FROM jsonb_array_elements(p_score_sets) WITH ORDINALITY AS sets(value, ordinality);

  IF v_total_one = v_total_two OR
     (p_winner_side = 1 AND v_total_one < v_total_two) OR
     (p_winner_side = 2 AND v_total_two < v_total_one) THEN
    RAISE EXCEPTION 'The selected winner does not match the set scores';
  END IF;

  IF v_scoring_template = 'team_two_sets_bonus_third' THEN
    IF v_first_two_one = 2 OR v_first_two_two = 2 THEN
      IF jsonb_array_length(p_score_sets) <> 2 THEN
        RAISE EXCEPTION 'A 2–0 team result must contain exactly two sets';
      END IF;
      IF v_first_two_one = 2 THEN v_points_one := 3; END IF;
      IF v_first_two_two = 2 THEN v_points_two := 3; END IF;
    ELSIF v_first_two_one = 1 AND v_first_two_two = 1 THEN
      IF jsonb_array_length(p_score_sets) <> 3 THEN
        RAISE EXCEPTION 'A split team result requires a deciding third set';
      END IF;
      v_points_one := CASE WHEN v_total_one > v_total_two THEN 2 ELSE 1 END;
      v_points_two := CASE WHEN v_total_two > v_total_one THEN 2 ELSE 1 END;
    ELSE
      RAISE EXCEPTION 'Team results require two sets, with a third only after a 1–1 split';
    END IF;
  ELSIF v_scoring_template = 'one_set' AND jsonb_array_length(p_score_sets) <> 1 THEN
    RAISE EXCEPTION 'This scoring template requires exactly one set';
  ELSIF v_scoring_template = 'best_of_three'
        AND (jsonb_array_length(p_score_sets) > 3 OR greatest(v_total_one, v_total_two) < 2) THEN
    RAISE EXCEPTION 'Best-of-three requires a player to win two sets, with no more than three sets';
  END IF;

  UPDATE public.tournament_matches
  SET score_sets = p_score_sets,
      winner_side = p_winner_side,
      status = 'completed',
      team_points_one = v_points_one,
      team_points_two = v_points_two,
      entered_by = (SELECT auth.uid()),
      updated_at = now()
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_captain_team_match_result(uuid,jsonb,smallint,integer,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_captain_team_match_result(uuid,jsonb,smallint,integer,integer)
  TO authenticated;
