-- Permit the Singles tournament format in event configuration.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_tournament_format_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_tournament_format_check
  CHECK (tournament_format IS NULL OR tournament_format IN ('doubles', 'team', 'singles'));
