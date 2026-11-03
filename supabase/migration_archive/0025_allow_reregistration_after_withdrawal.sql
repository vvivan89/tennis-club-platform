-- BEGIN MIGRATION: 0025_allow_reregistration_after_withdrawal.sql
-- A member may register again after withdrawing. Keep historical cancelled rows so
-- old score/payment references remain intact, but enforce uniqueness only for active
-- registrations (confirmed or waitlisted).
ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_event_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_id_user_id_active_key
  ON public.registrations (event_id, user_id)
  WHERE status <> 'cancelled';

-- Admin add/remove must also create a new registration after a prior withdrawal,
-- rather than trying to upsert against the old unconditional unique constraint.
CREATE OR REPLACE FUNCTION public.manage_event_registration(p_event_id uuid, p_user_id uuid, p_action text)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_existing public.registrations%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  IF p_action = 'remove' THEN
    SELECT * INTO v_existing
    FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled'
    ORDER BY created_at DESC
    LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.registrations
      SET status = 'cancelled', queue_position = NULL, updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    RETURN;
  ELSIF p_action <> 'add' THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Member is already registered or waitlisted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.member_suspensions
    WHERE user_id = p_user_id
      AND (current_date BETWEEN starts_on AND ends_on OR v_event.starts_at::date BETWEEN starts_on AND ends_on)
  ) THEN
    RAISE EXCEPTION 'This member is suspended for the event date';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.registrations
  WHERE event_id = p_event_id AND status = 'confirmed';

  IF v_count < v_event.capacity THEN
    v_status := 'confirmed';
    v_queue := NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(queue_position), 0) + 1 INTO v_queue
    FROM public.registrations
    WHERE event_id = p_event_id AND status = 'waitlisted';
    v_status := 'waitlisted';
  END IF;

  INSERT INTO public.registrations(event_id, user_id, status, queue_position, amount_cents, payment_status)
  VALUES (
    p_event_id, p_user_id, v_status, v_queue, v_event.price_cents,
    CASE WHEN v_event.price_cents = 0 THEN 'not_required' ELSE 'pending' END
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_status, v_queue;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_event_registration(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid, uuid, text) TO authenticated;
-- END MIGRATION: 0025_allow_reregistration_after_withdrawal.sql
