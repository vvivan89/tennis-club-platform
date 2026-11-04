ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS tournament_winners_announced boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tournament_winners jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_tournament_winners_array_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_tournament_winners_array_check
  CHECK (jsonb_typeof(tournament_winners) = 'array');
