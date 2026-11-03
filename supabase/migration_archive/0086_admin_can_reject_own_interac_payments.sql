-- Administrators may reject any Interac payment, including one they initiated.
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
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject') THEN RAISE EXCEPTION 'Unsupported manual payment action'; END IF;
  IF p_action = 'reject' AND v_note IS NULL THEN RAISE EXCEPTION 'A reason is required to reject a manual payment'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Manual review notes must be 1,000 characters or fewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'admin' AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'interac' THEN RAISE EXCEPTION 'Only Interac payments can be reviewed manually'; END IF;

  IF p_action = 'confirm' AND v_payment.status IN ('succeeded', 'partially_refunded', 'refunded') AND v_payment.manual_review_status = 'confirmed' THEN
    v_duplicate := true;
  ELSIF p_action = 'reject' AND v_payment.status = 'failed' AND v_payment.manual_review_status = 'rejected' THEN
    v_duplicate := true;
  ELSE
    IF v_payment.status <> 'pending' OR (v_payment.manual_review_status IS DISTINCT FROM 'submitted' AND v_payment.manual_review_status IS DISTINCT FROM 'investigating') THEN
      RAISE EXCEPTION 'This manual payment is no longer awaiting review';
    END IF;

    IF p_action = 'confirm' THEN
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
      CASE p_action WHEN 'confirm' THEN 'Manual Interac payment confirmed.' ELSE 'Manual Interac payment rejected.' END,
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
