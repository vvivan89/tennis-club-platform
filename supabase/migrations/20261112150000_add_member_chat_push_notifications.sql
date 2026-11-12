CREATE TABLE IF NOT EXISTS public.member_chat_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%'),
  p256dh text NOT NULL,
  auth text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS member_chat_push_subscriptions_user_enabled_idx
  ON public.member_chat_push_subscriptions (user_id, enabled);

CREATE TABLE IF NOT EXISTS public.member_chat_push_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE REFERENCES public.member_chat_messages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_chat_push_queue_pending_idx
  ON public.member_chat_push_queue (created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS public.member_chat_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.member_chat_messages(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.member_chat_push_subscriptions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'expired')),
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, subscription_id)
);

ALTER TABLE public.member_chat_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_chat_push_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_chat_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_chat_push_subscriptions, public.member_chat_push_queue,
  public.member_chat_push_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_chat_push_subscriptions,
  public.member_chat_push_queue, public.member_chat_push_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.queue_member_chat_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.member_chat_push_queue (message_id)
  VALUES (NEW.id)
  ON CONFLICT (message_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS queue_member_chat_push_notification ON public.member_chat_messages;
CREATE TRIGGER queue_member_chat_push_notification
AFTER INSERT ON public.member_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.queue_member_chat_push_notification();

CREATE OR REPLACE FUNCTION public.claim_member_chat_push_job(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed integer;
BEGIN
  UPDATE public.member_chat_push_queue AS jobs
  SET status = 'processing', attempts = jobs.attempts + 1,
      claimed_at = now(), updated_at = now(), last_error = NULL
  WHERE jobs.message_id = p_message_id
    AND (jobs.status IN ('pending', 'failed')
      OR (jobs.status = 'processing' AND jobs.claimed_at < now() - interval '5 minutes'));
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_member_chat_push_delivery(
  p_message_id uuid,
  p_subscription_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed integer;
BEGIN
  INSERT INTO public.member_chat_push_deliveries AS delivery (
    message_id, subscription_id, status, attempts, updated_at
  ) VALUES (p_message_id, p_subscription_id, 'sending', 1, now())
  ON CONFLICT (message_id, subscription_id) DO UPDATE
    SET status = 'sending', attempts = delivery.attempts + 1,
        updated_at = now(), last_error = NULL
    WHERE delivery.status = 'failed'
      OR (delivery.status = 'sending'
        AND delivery.updated_at < now() - interval '5 minutes');
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_member_chat_push_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_member_chat_push_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_member_chat_push_delivery(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_member_chat_push_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_member_chat_push_delivery(uuid, uuid) TO service_role;
