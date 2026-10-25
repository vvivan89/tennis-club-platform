-- Payment history proceeds and safe reuse of non-refunded tournament payments.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_fee_minor bigint,
  ADD COLUMN IF NOT EXISTS proceeds_minor bigint;

COMMENT ON COLUMN public.payments.stripe_fee_minor IS 'Stripe processing fee from the charge balance transaction, in minor currency units.';
COMMENT ON COLUMN public.payments.proceeds_minor IS 'Net proceeds from the charge balance transaction, in minor currency units.';

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
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL THEN 'stripe' ELSE NULL END,
    CASE WHEN v_status = 'confirmed' AND v_prior_payment.id IS NOT NULL
         THEN COALESCE(v_prior_payment.stripe_payment_intent_id, v_prior_payment.stripe_checkout_session_id)
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
