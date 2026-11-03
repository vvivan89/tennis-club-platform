-- BEGIN MIGRATION: 0023_fix_event_participant_replacement.sql
-- Fix participant replacement: the UI selects an approved member who is not yet on the event roster.
-- Transfer the existing registration row so court assignments and score references remain attached.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_reg uuid;
  v_event public.events%rowtype;
  v_new_profile public.profiles%rowtype;
  v_old_status public.registration_status;
BEGIN
  IF NOT public.is_event_manager() THEN
    RAISE EXCEPTION 'Only event managers can replace participants.';
  END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN
    RAISE EXCEPTION 'Choose two different members.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT id, status INTO old_reg, v_old_status
    FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_old_user_id AND status IN ('confirmed','waitlisted')
    LIMIT 1 FOR UPDATE;
  IF old_reg IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id) THEN
    RAISE EXCEPTION 'The selected member has a previous registration for this event. Choose a member who has never registered for this session.';
  END IF;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id=p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'The replacement must be an approved member.';
  END IF;
  IF v_event.members_only AND NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id=p_new_user_id AND m.status='active'
      AND (m.ends_on IS NULL OR m.ends_on >= current_date)
      AND (m.payment_status='paid' OR EXISTS (
        SELECT 1 FROM public.payments p WHERE p.membership_id=m.id AND p.status IN ('paid','recorded_manually')
      ))
  ) THEN
    RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.';
  END IF;
  -- Reusing the registration row preserves court assignments, queue position and score references.
  UPDATE public.registrations SET user_id=p_new_user_id, updated_at=now() WHERE id=old_reg;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;
-- END MIGRATION: 0023_fix_event_participant_replacement.sql
