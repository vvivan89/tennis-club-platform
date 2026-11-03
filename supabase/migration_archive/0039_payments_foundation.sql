-- Payments Foundation. This migration upgrades the legacy PCTC payments table in place
-- and is safe to rerun after a partial/manual application.

-- PostgREST upserts use this named unique key. PostgreSQL permits multiple NULLs
-- in a non-partial unique index, so legacy audit rows remain valid.
DROP INDEX IF EXISTS public.audit_logs_idempotency_key_idx;
CREATE UNIQUE INDEX audit_logs_idempotency_key_idx ON public.audit_logs (idempotency_key);

-- Create the target shape when payments does not yet exist. On existing installations
-- this is a no-op; the ALTER/normalization steps below upgrade the legacy table.
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  purpose text,
  business_record_id text,
  amount_minor bigint,
  currency text NOT NULL DEFAULT 'cad',
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  last_stripe_event_id text,
  failure_code text,
  failure_message text,
  refunded_amount_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz
);

-- Add missing target columns to the pre-existing legacy payments table.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS business_record_id text,
  ADD COLUMN IF NOT EXISTS amount_minor bigint,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS last_stripe_event_id text,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS refunded_amount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS succeeded_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_status text;

-- Remove legacy checks/triggers before translating old statuses and currencies.
DROP TRIGGER IF EXISTS guard_payment_status_transition ON public.payments;
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check,
  DROP CONSTRAINT IF EXISTS payments_currency_check,
  DROP CONSTRAINT IF EXISTS payments_amount_minor_check,
  DROP CONSTRAINT IF EXISTS payments_purpose_check,
  DROP CONSTRAINT IF EXISTS payments_amount_check,
  DROP CONSTRAINT IF EXISTS payments_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS payments_refunded_amount_check,
  DROP CONSTRAINT IF EXISTS payments_refund_status_check,
  DROP CONSTRAINT IF EXISTS payments_fully_refunded_check;

-- Preserve legacy values and map old records to the new lifecycle/model.
UPDATE public.payments
SET legacy_status = COALESCE(legacy_status, status);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE amount_minor IS NULL AND amount_cents IS NULL
  ) THEN
    RAISE EXCEPTION 'Payments migration cannot infer amount_minor for an existing row';
  END IF;
END;
$$;

-- JSON row access keeps this upgrade compatible with both the legacy schema
-- (membership_id/registration_id/amount_cents/paid_at) and an already-upgraded
-- table where those legacy columns are no longer present.
UPDATE public.payments AS p
SET
  purpose = COALESCE(
    p.purpose,
    CASE
      WHEN to_jsonb(p)->>'membership_id' IS NOT NULL THEN 'membership'
      WHEN to_jsonb(p)->>'registration_id' IS NOT NULL THEN 'event_registration'
      ELSE 'other'
    END
  ),
  business_record_id = COALESCE(
    p.business_record_id,
    to_jsonb(p)->>'membership_id',
    to_jsonb(p)->>'registration_id'
  ),
  amount_minor = COALESCE(p.amount_minor, (to_jsonb(p)->>'amount_cents')::bigint),
  currency = lower(p.currency),
  idempotency_key = COALESCE(p.idempotency_key, 'legacy:' || p.id::text),
  succeeded_at = CASE
    WHEN p.status IN ('paid', 'recorded_manually') THEN
      COALESCE(p.succeeded_at, (to_jsonb(p)->>'paid_at')::timestamptz)
    ELSE p.succeeded_at
  END,
  status = CASE p.status
    WHEN 'paid' THEN 'succeeded'
    WHEN 'recorded_manually' THEN 'succeeded'
    WHEN 'refunded' THEN 'refunded'
    ELSE p.status
  END;

-- Legacy rows marked refunded predate the refund ledger; the old status implies
-- a full refund, so normalize the aggregate amount accordingly.
UPDATE public.payments
SET refunded_amount_minor = amount_minor
WHERE status = 'refunded'
  AND refunded_amount_minor = 0
  AND legacy_status = 'refunded';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE purpose NOT IN ('membership', 'event_registration', 'other')
       OR amount_minor IS NULL OR amount_minor <= 0
       OR currency !~ '^[a-z]{3}$'
       OR idempotency_key IS NULL
       OR length(idempotency_key) NOT BETWEEN 1 AND 200
       OR status NOT IN ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'partially_refunded', 'refunded')
       OR refunded_amount_minor < 0 OR refunded_amount_minor > amount_minor
       OR (status IN ('partially_refunded', 'refunded') AND refunded_amount_minor = 0)
       OR (status = 'refunded' AND refunded_amount_minor <> amount_minor)
  ) THEN
    RAISE EXCEPTION 'Payments migration found a row that does not satisfy the Stripe payment model';
  END IF;
END;
$$;

ALTER TABLE public.payments
  ALTER COLUMN purpose SET NOT NULL,
  ALTER COLUMN amount_minor SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_purpose_check
    CHECK (purpose IN ('membership', 'event_registration', 'other')),
  ADD CONSTRAINT payments_amount_minor_check CHECK (amount_minor > 0),
  ADD CONSTRAINT payments_currency_check CHECK (currency ~ '^[a-z]{3}$'),
  ADD CONSTRAINT payments_status_check CHECK (status IN (
    'pending', 'processing', 'succeeded', 'failed', 'canceled', 'partially_refunded', 'refunded'
  )),
  ADD CONSTRAINT payments_idempotency_key_check
    CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  ADD CONSTRAINT payments_refunded_amount_check
    CHECK (refunded_amount_minor >= 0 AND refunded_amount_minor <= amount_minor),
  ADD CONSTRAINT payments_refund_status_check
    CHECK (status NOT IN ('partially_refunded', 'refunded') OR refunded_amount_minor > 0),
  ADD CONSTRAINT payments_fully_refunded_check
    CHECK (status <> 'refunded' OR refunded_amount_minor = amount_minor);

CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx ON public.payments(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_checkout_session_uidx
  ON public.payments(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_uidx
  ON public.payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_user_created_idx ON public.payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_created_idx ON public.payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_business_record_idx ON public.payments(purpose, business_record_id);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own payments" ON public.payments;
CREATE POLICY "Users read own payments" ON public.payments
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.payments FROM anon, authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  stripe_refund_id text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  status text NOT NULL CHECK (status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'unknown')),
  reason text,
  last_stripe_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_refunds_payment_idx ON public.payment_refunds(payment_id, created_at);
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own payment refunds" ON public.payment_refunds;
CREATE POLICY "Users read own payment refunds" ON public.payment_refunds
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_id AND p.user_id = (SELECT auth.uid()))
  );
REVOKE ALL ON public.payment_refunds FROM anon, authenticated;
GRANT SELECT ON public.payment_refunds TO authenticated;
GRANT ALL ON public.payment_refunds TO service_role;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  processing_status text NOT NULL DEFAULT 'processing' CHECK (processing_status IN ('processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_idx ON public.stripe_webhook_events(processing_status, updated_at);
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;

-- Atomic event claim: processed events cannot be claimed again. Failed events can
-- be retried; stale in-flight claims can be reclaimed after five minutes.
CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text, p_event_type text, p_livemode boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_claimed text;
BEGIN
  INSERT INTO public.stripe_webhook_events(stripe_event_id, event_type, livemode, processing_status, attempts)
  VALUES (p_event_id, p_event_type, p_livemode, 'processing', 1)
  ON CONFLICT (stripe_event_id) DO UPDATE SET
    processing_status = 'processing',
    attempts = public.stripe_webhook_events.attempts + 1,
    updated_at = now(),
    last_error = NULL
  WHERE public.stripe_webhook_events.processing_status = 'failed'
     OR (public.stripe_webhook_events.processing_status = 'processing'
         AND public.stripe_webhook_events.updated_at < now() - interval '5 minutes')
  RETURNING stripe_event_id INTO v_claimed;
  RETURN v_claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, boolean) TO service_role;

-- Enforce payment lifecycle transitions after legacy statuses have been normalized.
CREATE OR REPLACE FUNCTION public.guard_payment_status_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('processing','succeeded','failed','canceled')) OR
    (OLD.status = 'processing' AND NEW.status IN ('succeeded','failed','canceled')) OR
    (OLD.status = 'failed' AND NEW.status IN ('pending','processing','succeeded','canceled')) OR
    (OLD.status = 'succeeded' AND NEW.status IN ('partially_refunded','refunded')) OR
    (OLD.status = 'partially_refunded' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'Invalid payment status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_payment_status_transition ON public.payments;
CREATE TRIGGER guard_payment_status_transition BEFORE UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_status_transition();

-- Refund records must use the payment's currency.
CREATE OR REPLACE FUNCTION public.guard_payment_refund_currency() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_currency text;
BEGIN
  SELECT currency INTO v_currency FROM public.payments WHERE id = NEW.payment_id;
  IF v_currency IS NULL OR NEW.currency <> v_currency THEN
    RAISE EXCEPTION 'Refund currency must match its payment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_payment_refund_currency ON public.payment_refunds;
CREATE TRIGGER guard_payment_refund_currency BEFORE INSERT OR UPDATE ON public.payment_refunds
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_refund_currency();
