ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_court_count_check,
  ADD CONSTRAINT events_court_count_check
    CHECK (court_count BETWEEN 1 AND 6);
