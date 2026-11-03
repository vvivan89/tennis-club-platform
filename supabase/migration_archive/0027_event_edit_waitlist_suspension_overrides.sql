-- BEGIN MIGRATION: 0027_event_edit_waitlist_suspension_overrides.sql
-- Event managers can see event-date suspension status and explicitly override it
-- when manually adding/replacing a player. Self-service registration remains blocked.
DROP FUNCTION IF EXISTS public.event_member_directory();
CREATE FUNCTION public.event_member_directory(p_event_id uuid)
RETURNS TABLE(id uuid, full_name text, avatar_url text, email text, phone text, tennis_skill_level text, suspended boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_day date;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 SELECT (e.starts_at AT TIME ZONE 'America/Vancouver')::date INTO v_event_day FROM public.events e WHERE e.id=p_event_id;
 IF v_event_day IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
 RETURN QUERY
 SELECT p.id,p.full_name,p.avatar_url,p.email,p.phone,p.tennis_skill_level::text,
   EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=p.id AND s.cancelled_at IS NULL AND v_event_day BETWEEN s.starts_on AND s.ends_on) AS suspended
 FROM public.profiles p ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_member_directory(uuid) TO authenticated;

-- The trigger blocks suspended members from self-service registration, but allows
-- explicit event-manager operations. The UI asks for confirmation before those actions.
CREATE OR REPLACE FUNCTION public.reject_suspended_member_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event_day date;
BEGIN
 IF new.status='cancelled' THEN RETURN new; END IF;
 IF current_setting('app.event_manager_override_suspension', true) = 'on' THEN RETURN new; END IF;
 SELECT (e.starts_at AT TIME ZONE 'America/Vancouver')::date INTO event_day FROM public.events e WHERE e.id=new.event_id;
 IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=new.user_id AND s.cancelled_at IS NULL
   AND (current_date BETWEEN s.starts_on AND s.ends_on OR (event_day IS NOT NULL AND event_day BETWEEN s.starts_on AND s.ends_on))) THEN
   RAISE EXCEPTION 'Your account is suspended for this period and cannot register for club events.' USING errcode='42501';
 END IF;
 RETURN new;
END; $$;

CREATE OR REPLACE FUNCTION public.manage_event_registration(p_event_id uuid, p_user_id uuid, p_action text)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; v_existing public.registrations%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 PERFORM set_config('app.event_manager_override_suspension','on',true);
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
 IF p_action='remove' THEN
   SELECT * INTO v_existing FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
   IF FOUND THEN UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=v_existing.id; END IF;
   RETURN;
 ELSIF p_action<>'add' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Member is already registered or waitlisted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user_id AND p.application_status='approved') THEN RAISE EXCEPTION 'Member must have an approved account'; END IF;
 IF v_event.members_only AND NOT public.has_active_paid_membership(p_user_id) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL;
 ELSE
   IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
 VALUES(p_event_id,p_user_id,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END) RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid,uuid,text) TO authenticated;

-- Replacing a confirmed player with a waitlisted player promotes that waitlisted
-- registration directly, regardless of queue position, and transfers court/score links.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; old_row public.registrations%rowtype; new_row public.registrations%rowtype; v_count integer;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
 PERFORM set_config('app.event_manager_override_suspension','on',true);
 IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id=p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
 SELECT * INTO old_row FROM public.registrations WHERE event_id=p_event_id AND user_id=p_old_user_id AND status IN ('confirmed','waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF old_row.id IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
 SELECT * INTO new_row FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id AND status IN ('confirmed','waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF new_row.id IS NOT NULL AND new_row.status<>'waitlisted' THEN RAISE EXCEPTION 'The selected member is already confirmed for this event.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_new_user_id AND p.application_status='approved') THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
 IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.'; END IF;
 IF old_row.status='confirmed' AND new_row.status='waitlisted' THEN
   UPDATE public.event_court_assignments SET registration_id=new_row.id WHERE registration_id=old_row.id;
   UPDATE public.event_scores SET player_one_registration_id=new_row.id WHERE player_one_registration_id=old_row.id;
   UPDATE public.event_scores SET player_two_registration_id=new_row.id WHERE player_two_registration_id=old_row.id;
   UPDATE public.event_scores SET player_three_registration_id=new_row.id WHERE player_three_registration_id=old_row.id;
   UPDATE public.event_scores SET player_four_registration_id=new_row.id WHERE player_four_registration_id=old_row.id;
   UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=old_row.id;
   UPDATE public.registrations SET status='confirmed',queue_position=NULL,updated_at=now() WHERE id=new_row.id;
   WITH ranked AS (SELECT id,row_number() OVER(ORDER BY queue_position NULLS LAST,created_at,id) AS new_position FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted')
   UPDATE public.registrations r SET queue_position=ranked.new_position,updated_at=now() FROM ranked WHERE r.id=ranked.id;
 ELSIF new_row.id IS NULL THEN
   UPDATE public.registrations SET user_id=p_new_user_id,updated_at=now() WHERE id=old_row.id;
 ELSE
   RAISE EXCEPTION 'The selected member cannot replace this player.';
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;
-- END MIGRATION: 0027_event_edit_waitlist_suspension_overrides.sql
