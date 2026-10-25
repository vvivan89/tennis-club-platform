-- Track payment reminders per registration so withdrawn/re-registered members
-- can receive reminders for the new registration without duplicating old sends.
CREATE TABLE IF NOT EXISTS public.event_registration_payment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('24h', '1h')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (registration_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS event_registration_payment_reminders_event_idx
  ON public.event_registration_payment_reminders(event_id, reminder_type, sent_at);

ALTER TABLE public.event_registration_payment_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_registration_payment_reminders FROM PUBLIC, anon, authenticated;
