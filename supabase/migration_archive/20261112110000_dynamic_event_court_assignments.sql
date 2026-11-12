-- Court choices must follow each event's configured court_count (currently 1-6).
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_court_count_check,
  ADD CONSTRAINT events_court_count_check CHECK (court_count BETWEEN 1 AND 6);

ALTER TABLE public.event_court_assignments
  DROP CONSTRAINT IF EXISTS event_court_assignments_court_number_check,
  ADD CONSTRAINT event_court_assignments_court_number_check
    CHECK (court_number BETWEEN 1 AND 6);

ALTER TABLE public.league_event_court_assignments
  DROP CONSTRAINT IF EXISTS league_event_court_assignments_court_number_check,
  ADD CONSTRAINT league_event_court_assignments_court_number_check
    CHECK (court_number BETWEEN 1 AND 6);

ALTER TABLE public.tournament_matches
  DROP CONSTRAINT IF EXISTS tournament_matches_court_number_check,
  ADD CONSTRAINT tournament_matches_court_number_check
    CHECK (court_number IS NULL OR court_number BETWEEN 1 AND 6);

-- Validate regular-event court assignments against the event's own court count.
DO $$
DECLARE
  v_function_definition text;
  v_old_check text := 'a.court_number NOT BETWEEN 1 AND 4';
BEGIN
  v_function_definition := pg_get_functiondef(
    'public.save_event_court_assignments(uuid,jsonb,text)'::regprocedure
  );
  IF position(v_old_check IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate the regular event court limit in save_event_court_assignments';
  END IF;
  v_function_definition := replace(
    v_function_definition,
    v_old_check,
    'a.court_number NOT BETWEEN 1 AND v_event.court_count'
  );
  EXECUTE v_function_definition;

  -- League assignment is also bound to the configured court count. Keep the
  -- separate sub-session limit unchanged.
  v_function_definition := pg_get_functiondef(
    'public.save_league_event_court_assignments(uuid,jsonb)'::regprocedure
  );
  v_old_check := '(item->>''court_number'')::integer NOT BETWEEN 1 AND 4';
  IF position(v_old_check IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Could not locate the League court limit in save_league_event_court_assignments';
  END IF;
  v_function_definition := replace(
    v_function_definition,
    v_old_check,
    '(item->>''court_number'')::integer NOT BETWEEN 1 AND (SELECT e.court_count FROM public.events e WHERE e.id=p_event_id)'
  );
  EXECUTE v_function_definition;
END;
$$;
