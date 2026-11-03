-- BEGIN MIGRATION: 0012_applications_suspensions_score_cutoff.sql
-- New account applications require explicit administrator approval.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS application_status text NOT NULL DEFAULT 'pending' CHECK (application_status IN ('pending','approved','dismissed'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS application_comment text NOT NULL DEFAULT '';
-- Existing accounts keep their access; newly created profiles remain pending by default.
UPDATE public.profiles SET application_status='approved' WHERE created_at < now();

CREATE OR REPLACE FUNCTION public.prevent_self_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) = OLD.id AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'You cannot change your own role.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS prevent_self_role_change_trigger ON public.profiles;
CREATE TRIGGER prevent_self_role_change_trigger BEFORE UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_change();
CREATE OR REPLACE FUNCTION public.prevent_self_application_status_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN IF (SELECT auth.uid())=OLD.id AND NEW.application_status IS DISTINCT FROM OLD.application_status THEN RAISE EXCEPTION 'Only administrators can process an application.'; END IF; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS prevent_self_application_status_change_trigger ON public.profiles;
CREATE TRIGGER prevent_self_application_status_change_trigger BEFORE UPDATE OF application_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_self_application_status_change();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(new.raw_user_meta_data ->> 'tennis_skill_level', '') NOT IN ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') THEN RAISE EXCEPTION 'A valid tennis skill rating is required to register.'; END IF;
  IF coalesce(trim(new.raw_user_meta_data ->> 'phone'), '') = '' THEN RAISE EXCEPTION 'A phone number is required to register.'; END IF;
  INSERT INTO public.profiles (id,email,full_name,phone,tennis_skill_level,application_comment,application_status)
  VALUES (new.id,new.email,coalesce(new.raw_user_meta_data ->> 'full_name',''),trim(new.raw_user_meta_data ->> 'phone'),new.raw_user_meta_data ->> 'tennis_skill_level',coalesce(new.raw_user_meta_data ->> 'application_comment',''),'pending');
  RETURN new;
END; $$;

-- Registration must be blocked for unapproved applications and only evaluate the suspension against the event date.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_event public.events%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid; v_member boolean;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.application_status='approved') THEN RAISE EXCEPTION 'Your registration is pending administrator approval.'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status<>'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
 IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN RAISE EXCEPTION 'Registration is unavailable for events that have already started'; END IF;
 IF now()<v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
 IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=v_user AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.'; END IF;
 IF v_event.members_only THEN
   SELECT EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=v_user AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date) AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments p WHERE p.membership_id=m.id AND p.status IN ('paid','recorded_manually')))) INTO v_member;
   IF NOT v_member THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.registrations r WHERE r.event_id=p_event_id AND r.user_id=v_user AND r.status<>'cancelled') THEN RAISE EXCEPTION 'You are already registered or waitlisted'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL; ELSE
   IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(r.queue_position),0)+1 INTO v_queue FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status) VALUES(p_event_id,v_user,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END) RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

-- Event managers adding members must also respect the event date (not the current date).
CREATE OR REPLACE FUNCTION public.block_scores_after_two_days()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_start timestamptz; v_type text;
BEGIN
 SELECT starts_at,event_type INTO v_start,v_type FROM public.events WHERE id=NEW.event_id;
 IF v_type='tournament' THEN RAISE EXCEPTION 'Scores are not available for tournament events.'; END IF;
 IF v_start < now() - interval '2 days' THEN RAISE EXCEPTION 'Scores can only be entered within two days of the event.'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS block_old_event_scores ON public.event_scores;
CREATE TRIGGER block_old_event_scores BEFORE INSERT OR UPDATE ON public.event_scores FOR EACH ROW EXECUTE FUNCTION public.block_scores_after_two_days();

-- Make the public scoreboard unavailable to unauthenticated visitors and require a paid member's own registration.
REVOKE SELECT ON public.event_scoreboard FROM anon;


-- Admin-assisted registration and waitlist promotion should evaluate suspension against the event date only.
CREATE OR REPLACE FUNCTION public.manage_event_registration(p_event_id uuid, p_user_id uuid, p_action text)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.events%rowtype; v_existing public.registrations%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
 IF p_action='remove' THEN
   SELECT * INTO v_existing FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled' FOR UPDATE;
   IF FOUND THEN UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=v_existing.id; END IF;
   RETURN;
 ELSIF p_action<>'add' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=p_user_id AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN RAISE EXCEPTION 'This member is suspended for the event date'; END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Member is already registered or waitlisted'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL; ELSE
   IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status) VALUES(p_event_id,p_user_id,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
 ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,queue_position=EXCLUDED.queue_position,amount_cents=EXCLUDED.amount_cents,payment_status=EXCLUDED.payment_status,updated_at=now() RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_capacity integer; v_confirmed integer; v_next uuid;
BEGIN
 SELECT capacity INTO v_capacity FROM public.events WHERE id=p_event_id FOR UPDATE; IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO v_confirmed FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 WHILE v_confirmed<v_capacity LOOP
  SELECT r.id INTO v_next FROM public.registrations r JOIN public.events e ON e.id=r.event_id WHERE r.event_id=p_event_id AND r.status='waitlisted' AND NOT EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=r.user_id AND (e.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) ORDER BY r.queue_position NULLS LAST,r.created_at,r.id LIMIT 1 FOR UPDATE OF r;
  EXIT WHEN v_next IS NULL;
  UPDATE public.registrations SET status='confirmed',queue_position=NULL,updated_at=now() WHERE id=v_next; v_confirmed:=v_confirmed+1; v_next:=NULL;
 END LOOP;
 WITH numbered AS (SELECT id,row_number() OVER(ORDER BY queue_position NULLS LAST,created_at,id) AS new_pos FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted') UPDATE public.registrations r SET queue_position=n.new_pos,updated_at=now() FROM numbered n WHERE r.id=n.id;
END; $$;
REVOKE ALL ON FUNCTION public.promote_event_waitlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_event_waitlist(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id,r.event_id,r.user_id,r.status,r.queue_position,r.created_at AS registered_at,p.full_name,p.avatar_url,p.tennis_skill_level
FROM public.registrations r JOIN public.profiles p ON p.id=r.user_id JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager()) AND r.status IN ('confirmed','waitlisted')
AND (public.is_event_manager() OR ((SELECT auth.uid()) IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
 AND EXISTS(SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
 AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
  AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))));
GRANT SELECT ON public.event_roster TO anon,authenticated;

CREATE OR REPLACE VIEW public.event_scoreboard AS
SELECT s.id,s.event_id,s.player_one_registration_id,s.player_two_registration_id,s.player_one_score,s.player_two_score,s.played_at,
 p1.full_name AS player_one_name,p2.full_name AS player_two_name,s.player_three_registration_id,s.player_four_registration_id,
 p3.full_name AS player_three_name,p4.full_name AS player_four_name
FROM public.event_scores s JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
JOIN public.events e ON e.id=s.event_id
WHERE e.event_type<>'tournament' AND (e.status='published' OR public.is_event_manager())
AND (public.is_event_manager() OR ((SELECT auth.uid()) IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
 AND EXISTS(SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
 AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
  AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))));
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

DROP POLICY IF EXISTS "Published events visible" ON public.events;
CREATE POLICY "Public published and cancelled events visible" ON public.events FOR SELECT TO anon,authenticated
USING (status IN ('published','cancelled') OR public.is_event_manager());
CREATE OR REPLACE VIEW public.event_public_counts AS
SELECT e.id AS event_id,count(r.id) FILTER (WHERE r.status='confirmed')::integer AS confirmed_count
FROM public.events e LEFT JOIN public.registrations r ON r.event_id=e.id
WHERE e.status IN ('published','cancelled') OR public.is_event_manager()
GROUP BY e.id;
GRANT SELECT ON public.event_public_counts TO anon,authenticated;


CREATE OR REPLACE FUNCTION public.withdraw_from_event(p_registration_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_registration public.registrations%rowtype; v_event public.events%rowtype;
BEGIN
 SELECT * INTO v_registration FROM public.registrations WHERE id=p_registration_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=v_registration.event_id;
 IF v_event.status='cancelled' THEN RAISE EXCEPTION 'Attendance cannot be changed for a cancelled event.'; END IF;
 IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'The registration cutoff has passed; you can no longer withdraw.'; END IF;
 IF v_registration.status='cancelled' THEN RETURN; END IF;
 UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=p_registration_id;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_from_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_from_event(uuid) TO authenticated;
-- END MIGRATION: 0012_applications_suspensions_score_cutoff.sql
