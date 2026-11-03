-- Migration 0045: Interac manual payment review foundation.
-- Safe to apply after 0044. This is database support only; member/admin UI,
-- initiation APIs and notification delivery must be implemented separately.

-- Preserve any pre-existing provider values from the legacy payments schema.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS manual_review_status text,
  ADD COLUMN IF NOT EXISTS manual_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_instructions_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_instructions_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_outcome_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_outcome_claimed_at timestamptz;

-- In older deployments `provider` already existed with the value `etransfer`.
-- Drop its legacy check before normalizing, then preserve historical cash/cheque/etc.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_provider_check,
  ALTER COLUMN provider SET DEFAULT 'stripe';
UPDATE public.payments SET provider = 'stripe' WHERE provider IS NULL;
UPDATE public.payments SET provider = 'interac' WHERE provider = 'etransfer';
UPDATE public.payments
SET manual_review_status = CASE
      WHEN status = 'pending' THEN 'submitted'
      WHEN status IN ('succeeded', 'partially_refunded', 'refunded') THEN 'confirmed'
      WHEN status = 'failed' THEN 'rejected'
      WHEN status = 'canceled' THEN 'cancelled'
      ELSE NULL
    END,
    manual_submitted_at = COALESCE(manual_submitted_at, created_at),
    manual_confirmed_at = CASE
      WHEN status IN ('succeeded', 'partially_refunded', 'refunded') THEN COALESCE(manual_confirmed_at, succeeded_at, created_at)
      ELSE manual_confirmed_at END,
    manual_rejected_at = CASE WHEN status = 'failed' THEN COALESCE(manual_rejected_at, failed_at, updated_at) ELSE manual_rejected_at END
WHERE provider = 'interac' AND manual_review_status IS NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_provider_check,
  DROP CONSTRAINT IF EXISTS payments_manual_review_status_check,
  DROP CONSTRAINT IF EXISTS payments_manual_review_state_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_provider_check
    CHECK (provider IN ('stripe', 'interac', 'paypal', 'cash', 'cheque', 'other')),
  ADD CONSTRAINT payments_manual_review_status_check
    CHECK (manual_review_status IS NULL OR manual_review_status IN ('submitted', 'investigating', 'confirmed', 'rejected', 'cancelled')),
  ADD CONSTRAINT payments_manual_review_state_check CHECK (
    (provider <> 'interac' AND manual_review_status IS NULL)
    OR (provider = 'interac' AND (
      (manual_review_status IN ('submitted', 'investigating') AND status = 'pending')
      OR (manual_review_status = 'confirmed' AND status IN ('succeeded', 'partially_refunded', 'refunded'))
      OR (manual_review_status = 'rejected' AND status = 'failed')
      OR (manual_review_status = 'cancelled' AND status = 'canceled')
    ))
  );

ALTER TABLE public.payments ALTER COLUMN provider SET NOT NULL;
CREATE INDEX IF NOT EXISTS payments_manual_review_idx
  ON public.payments(manual_review_status, created_at DESC)
  WHERE provider = 'interac';

CREATE TABLE IF NOT EXISTS public.payment_manual_review_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note_type text NOT NULL CHECK (note_type IN ('internal', 'rejection')),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_manual_review_notes_payment_idx
  ON public.payment_manual_review_notes(payment_id, created_at DESC);
ALTER TABLE public.payment_manual_review_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read manual payment review notes" ON public.payment_manual_review_notes;
CREATE POLICY "Admins read manual payment review notes" ON public.payment_manual_review_notes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid())
      AND p.role = 'admin' AND p.application_status = 'approved')
  );
REVOKE ALL ON public.payment_manual_review_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_manual_review_notes TO authenticated;
GRANT ALL ON public.payment_manual_review_notes TO service_role;

-- Fulfillment validates the actual configured price and record ownership before
-- activating benefits. Any exception rolls back the payment status change too.
CREATE OR REPLACE FUNCTION public.fulfill_successful_payment(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_registration_id uuid;
  v_family_id uuid;
  v_updated integer;
  v_expected_amount bigint;
  v_family_member boolean;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF v_payment.status NOT IN ('succeeded', 'partially_refunded') THEN
    RAISE EXCEPTION 'Only successful, not-fully-refunded payments can be fulfilled';
  END IF;
  IF lower(v_payment.currency) <> 'cad' THEN RAISE EXCEPTION 'PCTC payments must be in CAD'; END IF;

  IF v_payment.purpose = 'membership' THEN
    SELECT COALESCE(single_price_cents, 0) INTO v_expected_amount
    FROM public.membership_plan_settings WHERE id = 1;
    IF v_payment.business_record_id LIKE 'family:%' THEN
      IF substring(v_payment.business_record_id FROM 8) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid family reference on payment';
      END IF;
      v_family_id := substring(v_payment.business_record_id FROM 8)::uuid;
      SELECT COALESCE(family_price_cents, 0) INTO v_expected_amount
      FROM public.membership_plan_settings WHERE id = 1;
      IF NOT EXISTS (SELECT 1 FROM public.membership_families f WHERE f.id = v_family_id) THEN
        RAISE EXCEPTION 'Family membership record was not found';
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM public.membership_family_members fm
        WHERE fm.family_id = v_family_id AND fm.user_id = v_payment.user_id
          AND fm.status = 'confirmed'
      ) INTO v_family_member;
      IF NOT v_family_member THEN RAISE EXCEPTION 'Payer is not a confirmed member of this family'; END IF;
      IF v_expected_amount IS NULL OR v_expected_amount <= 0 OR v_payment.amount_minor <> v_expected_amount THEN
        RAISE EXCEPTION 'Payment amount does not match the configured family membership price';
      END IF;
      UPDATE public.membership_families
      SET paid_at = COALESCE(paid_at, now()),
          paid_by = COALESCE(paid_by, v_payment.user_id),
          payment_id = COALESCE(payment_id, v_payment.id)
      WHERE id = v_family_id AND (payment_id IS NULL OR payment_id = v_payment.id);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
      IF EXISTS (SELECT 1 FROM public.membership_families WHERE id = v_family_id AND payment_id = v_payment.id AND paid_at IS NOT NULL) THEN RETURN; END IF;
      RAISE EXCEPTION 'Family membership was already paid by a different payment';
    END IF;

    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid membership reference on payment';
    END IF;
    v_membership_id := v_payment.business_record_id::uuid;
    IF v_expected_amount IS NULL OR v_expected_amount <= 0 OR v_payment.amount_minor <> v_expected_amount THEN
      RAISE EXCEPTION 'Payment amount does not match the configured individual membership price';
    END IF;
    UPDATE public.memberships
    SET status = 'active', payment_status = 'paid', updated_at = now()
    WHERE id = v_membership_id AND user_id = v_payment.user_id
      AND lower(membership_type) NOT LIKE '%family%';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.memberships WHERE id = v_membership_id AND user_id = v_payment.user_id AND status = 'active' AND payment_status = 'paid') THEN RETURN; END IF;
    RAISE EXCEPTION 'Membership record was not found, does not belong to the payer, or is not an individual membership';

  ELSIF v_payment.purpose = 'event_registration' THEN
    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid registration reference on payment';
    END IF;
    v_registration_id := v_payment.business_record_id::uuid;
    UPDATE public.registrations r
    SET payment_status = 'paid',
        payment_provider = v_payment.provider,
        provider_reference = COALESCE(v_payment.stripe_payment_intent_id, v_payment.stripe_checkout_session_id, 'payment:' || v_payment.id::text),
        updated_at = now()
    FROM public.events e
    WHERE r.id = v_registration_id AND r.event_id = e.id
      AND r.user_id = v_payment.user_id AND r.status = 'confirmed'
      AND r.amount_cents = v_payment.amount_minor AND e.price_cents = v_payment.amount_minor
      AND r.payment_status IN ('pending', 'failed', 'paid');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.registrations WHERE id = v_registration_id AND user_id = v_payment.user_id AND payment_status = 'paid' AND status = 'confirmed') THEN RETURN; END IF;
    RAISE EXCEPTION 'Confirmed registration does not match the successful payment';
  ELSE
    RAISE EXCEPTION 'Unsupported payment purpose for fulfillment';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_successful_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_successful_payment(uuid) TO service_role;

-- Derive the actor from auth.uid() rather than trusting an actor ID supplied by
-- the browser. Call this RPC with the authenticated user's Supabase client.
CREATE OR REPLACE FUNCTION public.review_manual_payment(
  p_payment_id uuid, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_note text := NULLIF(btrim(p_note), '');
  v_now timestamptz := now();
  v_duplicate boolean := false;
  v_note_type text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject', 'investigate') THEN RAISE EXCEPTION 'Unsupported manual payment action'; END IF;
  IF p_action = 'reject' AND v_note IS NULL THEN RAISE EXCEPTION 'A reason is required to reject a manual payment'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Manual review notes must be 1,000 characters or fewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'admin' AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'interac' THEN RAISE EXCEPTION 'Only Interac payments can be reviewed manually'; END IF;
  IF v_payment.user_id = v_actor THEN RAISE EXCEPTION 'Administrators cannot review their own payments'; END IF;

  IF p_action = 'confirm' AND v_payment.status IN ('succeeded', 'partially_refunded', 'refunded') AND v_payment.manual_review_status = 'confirmed' THEN
    v_duplicate := true;
  ELSIF p_action = 'reject' AND v_payment.status = 'failed' AND v_payment.manual_review_status = 'rejected' THEN
    v_duplicate := true;
  ELSE
    IF v_payment.status <> 'pending' OR (v_payment.manual_review_status IS DISTINCT FROM 'submitted' AND v_payment.manual_review_status IS DISTINCT FROM 'investigating') THEN
      RAISE EXCEPTION 'This manual payment is no longer awaiting review';
    END IF;

    IF p_action = 'investigate' THEN
      UPDATE public.payments SET manual_review_status = 'investigating', updated_at = v_now WHERE id = p_payment_id;
      v_note_type := 'internal';
    ELSIF p_action = 'confirm' THEN
      UPDATE public.payments SET status = 'succeeded', succeeded_at = v_now,
        manual_review_status = 'confirmed', manual_confirmed_at = v_now, manual_confirmed_by = v_actor,
        failure_code = NULL, failure_message = NULL, updated_at = v_now
      WHERE id = p_payment_id;
      -- If fulfillment validation fails, PostgreSQL rolls back this entire function call.
      PERFORM public.fulfill_successful_payment(p_payment_id);
      v_note_type := 'internal';
    ELSE
      UPDATE public.payments SET status = 'failed', failed_at = v_now,
        failure_code = 'manual_rejected', failure_message = left(v_note, 1000),
        manual_review_status = 'rejected', manual_rejected_at = v_now, manual_rejected_by = v_actor,
        updated_at = v_now WHERE id = p_payment_id;
      -- Keep the associated record unpaid and explicitly expose failure where supported.
      IF v_payment.purpose = 'event_registration' THEN
        UPDATE public.registrations SET payment_status = 'failed', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id
          AND status = 'confirmed' AND payment_status IN ('pending', 'failed');
      ELSIF v_payment.purpose = 'membership' AND v_payment.business_record_id !~ '^family:' THEN
        UPDATE public.memberships SET payment_status = 'unpaid', updated_at = v_now
        WHERE id::text = v_payment.business_record_id AND user_id = v_payment.user_id AND status <> 'active';
      END IF;
      v_note_type := 'rejection';
    END IF;

    IF v_note IS NOT NULL THEN
      INSERT INTO public.payment_manual_review_notes(payment_id, actor_user_id, note_type, note)
      VALUES (p_payment_id, v_actor, v_note_type, left(v_note, 1000));
    END IF;

    INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, target_record_id, source, summary, changes)
    VALUES (v_actor, 'admin', 'payment.manual_' || p_action, 'success', 'payments', p_payment_id::text,
      'manual_payment_review',
      CASE p_action WHEN 'confirm' THEN 'Manual Interac payment confirmed.' WHEN 'reject' THEN 'Manual Interac payment rejected.' ELSE 'Manual Interac payment marked for investigation.' END,
      jsonb_build_object('provider', v_payment.provider, 'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id));
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  RETURN jsonb_build_object('paymentId', v_payment.id, 'userId', v_payment.user_id,
    'purpose', v_payment.purpose, 'businessRecordId', v_payment.business_record_id,
    'amountMinor', v_payment.amount_minor, 'currency', v_payment.currency,
    'status', v_payment.status, 'manualReviewStatus', v_payment.manual_review_status, 'duplicate', v_duplicate);
END;
$$;
REVOKE ALL ON FUNCTION public.review_manual_payment(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_manual_payment(uuid, text, text) TO authenticated;

-- Preserve the existing event-registration rules; only correct provider reuse for prior paid registrations.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
  v_prior_payment public.payments%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Your registration is pending administrator approval.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
  IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN
    RAISE EXCEPTION 'Registration is unavailable for events that have already started';
  END IF;
  IF now() < v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id = v_user AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.';
  END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(v_user) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id = p_event_id AND r.user_id = v_user AND r.status <> 'cancelled') THEN
    RAISE EXCEPTION 'You are already registered or waitlisted';
  END IF;
  SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'confirmed';
  IF v_count < v_event.capacity THEN v_status := 'confirmed'; v_queue := NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(r.queue_position), 0) + 1 INTO v_queue FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'waitlisted';
    v_status := 'waitlisted';
  END IF;
  -- Reuse a prior successful, never-refunded payment when the same member
  -- withdraws and later registers for this same event at the same price.
  -- A waitlisted registration is not marked paid until it has a confirmed place.
  IF v_event.price_cents > 0 AND v_status = 'confirmed' THEN
    SELECT p.* INTO v_prior_payment
    FROM public.payments p
    JOIN public.registrations previous_registration
      ON previous_registration.id::text = p.business_record_id
    WHERE p.user_id = v_user
      AND p.purpose = 'event_registration'
      AND p.status = 'succeeded'
      AND COALESCE(p.refunded_amount_minor, 0) = 0
      AND p.amount_minor = v_event.price_cents
      AND previous_registration.event_id = p_event_id
      AND previous_registration.user_id = v_user
      AND previous_registration.status = 'cancelled'
    ORDER BY p.succeeded_at DESC NULLS LAST, p.created_at DESC
    LIMIT 1;
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  INSERT INTO public.registrations(
    event_id, user_id, status, queue_position, amount_cents, payment_status,
    payment_provider, provider_reference
  )
  VALUES (
    p_event_id, v_user, v_status, v_queue, v_event.price_cents,
    CASE WHEN v_event.price_cents = 0 THEN 'not_required'
         WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL THEN 'paid'
         ELSE 'pending' END,
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL THEN COALESCE(v_prior_payment.provider, 'stripe') ELSE NULL END,
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL
         THEN COALESCE(v_prior_payment.stripe_payment_intent_id, v_prior_payment.stripe_checkout_session_id, 'payment:' || v_prior_payment.id::text)
         ELSE NULL END
  )
  RETURNING id INTO v_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);
  PERFORM public.record_business_audit_event(
    'event.registration.created', 'Added ' || coalesce(v_profile.full_name, 'a player') || ' to ' || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'added', 'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', NULL, 'new_status', v_status, 'new_queue_position', v_queue
    )), 'operation', 'added'),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'new_status', v_status, 'queue_position', v_queue),
    NULL, 'rpc', p_idempotency_key
  );
  RETURN QUERY SELECT v_id, v_status, v_queue;
END;
$$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, text) TO authenticated;
