ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_membership_reminders boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_type text NOT NULL CHECK (
    email_type IN (
      'registration_updates',
      'waitlist_updates',
      'event_cancellations',
      'registration_reminders',
      'membership_reminders',
      'new_events',
      'newsletter'
    )
  ),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_unsubscribe_tokens_user_type_idx
  ON public.email_unsubscribe_tokens (user_id, email_type)
  WHERE used_at IS NULL;

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_unsubscribe_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_unsubscribe_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.apply_email_unsubscribe(p_token_hash text)
RETURNS TABLE (outcome text, email_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.email_unsubscribe_tokens%ROWTYPE;
  v_updated integer;
BEGIN
  SELECT * INTO v_token
  FROM public.email_unsubscribe_tokens AS tokens
  WHERE tokens.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text;
    RETURN;
  END IF;

  IF v_token.expires_at <= now() THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text;
    RETURN;
  END IF;

  IF v_token.used_at IS NOT NULL THEN
    RETURN QUERY SELECT 'already_used'::text, v_token.email_type;
    RETURN;
  END IF;

  UPDATE public.profiles AS profile
  SET
    email_registration_updates = CASE WHEN v_token.email_type = 'registration_updates' THEN false ELSE profile.email_registration_updates END,
    email_waitlist_updates = CASE WHEN v_token.email_type = 'waitlist_updates' THEN false ELSE profile.email_waitlist_updates END,
    email_event_cancellations = CASE WHEN v_token.email_type = 'event_cancellations' THEN false ELSE profile.email_event_cancellations END,
    email_registration_reminders = CASE WHEN v_token.email_type = 'registration_reminders' THEN false ELSE profile.email_registration_reminders END,
    email_membership_reminders = CASE WHEN v_token.email_type = 'membership_reminders' THEN false ELSE profile.email_membership_reminders END,
    email_new_events = CASE WHEN v_token.email_type = 'new_events' THEN false ELSE profile.email_new_events END,
    email_newsletter = CASE WHEN v_token.email_type = 'newsletter' THEN false ELSE profile.email_newsletter END
  WHERE profile.id = v_token.user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text;
    RETURN;
  END IF;

  UPDATE public.email_unsubscribe_tokens AS tokens
  SET used_at = now()
  WHERE tokens.user_id = v_token.user_id
    AND tokens.email_type = v_token.email_type
    AND tokens.used_at IS NULL;

  RETURN QUERY SELECT 'unsubscribed'::text, v_token.email_type;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_email_unsubscribe(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_email_unsubscribe(text) TO service_role;
