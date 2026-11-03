-- BEGIN MIGRATION: 0016_email_announcement_history.sql
CREATE TABLE IF NOT EXISTS public.email_announcement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body_html text NOT NULL,
  recipient_group text NOT NULL,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_announcement_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_announcement_history FROM PUBLIC, anon, authenticated;
-- END MIGRATION: 0016_email_announcement_history.sql
