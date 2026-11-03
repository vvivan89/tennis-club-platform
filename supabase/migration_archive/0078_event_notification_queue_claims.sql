-- Lets a dispatch run claim queue rows before sending so concurrent runs cannot mail the same row twice.
BEGIN;

ALTER TABLE public.event_notification_queue
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMIT;
