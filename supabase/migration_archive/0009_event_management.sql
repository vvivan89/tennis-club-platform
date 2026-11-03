-- BEGIN MIGRATION: 0009_event_management.sql
-- Full event scheduling, recurring sessions, waitlists, court assignments, and scores.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
UPDATE public.events SET event_type='ladder' WHERE event_type='program';
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK (event_type IN ('social','ladder','tournament'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS series_id uuid;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT 'Port Coquitlam Tennis Club';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS waitlist_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS court_count integer NOT NULL DEFAULT 4 CHECK (court_count BETWEEN 1 AND 4);

CREATE TABLE IF NOT EXISTS public.event_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  recurrence_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_on date NOT NULL,
  repeats_until date NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (repeats_until >= starts_on)
);
ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event managers manage event series" ON public.event_series;
CREATE POLICY "Event managers manage event series" ON public.event_series FOR ALL TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='organizer'))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='organizer'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_series TO authenticated;

CREATE OR REPLACE FUNCTION public.is_event_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.role IN ('admin','organizer'));
$$;
DROP POLICY IF EXISTS "Admins manage events" ON public.events;
DROP POLICY IF EXISTS "Event managers manage events" ON public.events;
CREATE POLICY "Event managers manage events" ON public.events FOR ALL TO authenticated
 USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());

CREATE TABLE IF NOT EXISTS public.event_court_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  court_number integer NOT NULL CHECK (court_number BETWEEN 1 AND 4),
  segment_order integer NOT NULL DEFAULT 1 CHECK (segment_order BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(registration_id, court_number, segment_order)
);
CREATE INDEX IF NOT EXISTS event_court_assignments_event_idx ON public.event_court_assignments(event_id,court_number,segment_order);
ALTER TABLE public.event_court_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments FOR SELECT TO anon, authenticated
 USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_court_assignments.event_id AND e.status='published'));
DROP POLICY IF EXISTS "Event managers manage court assignments" ON public.event_court_assignments;
CREATE POLICY "Event managers manage court assignments" ON public.event_court_assignments FOR ALL TO authenticated
 USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());
GRANT SELECT ON public.event_court_assignments TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_court_assignments TO authenticated;

CREATE TABLE IF NOT EXISTS public.event_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_one_registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  player_two_registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  player_one_score integer NOT NULL CHECK (player_one_score >= 0),
  player_two_score integer NOT NULL CHECK (player_two_score >= 0),
  played_at timestamptz NOT NULL DEFAULT now(),
  entered_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (player_one_registration_id <> player_two_registration_id)
);
ALTER TABLE public.event_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores FOR SELECT TO anon, authenticated
 USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.status='published'));
DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated
 WITH CHECK (
   entered_by=(SELECT auth.uid()) AND
   EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.status='confirmed') AND
   EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed') AND
   EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.event_id=event_scores.event_id)
 );
DROP POLICY IF EXISTS "Event managers manage scores" ON public.event_scores;
CREATE POLICY "Event managers manage scores" ON public.event_scores FOR ALL TO authenticated USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());
GRANT SELECT, INSERT ON public.event_scores TO authenticated;
GRANT SELECT ON public.event_scores TO anon;

-- Read-only roster views deliberately expose names/avatars and event participation, not email or phone.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position, r.created_at AS registered_at,
       p.full_name, p.avatar_url
FROM public.registrations r JOIN public.profiles p ON p.id=r.user_id JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager()) AND r.status IN ('confirmed','waitlisted');
GRANT SELECT ON public.event_roster TO anon, authenticated;
CREATE OR REPLACE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.id=s.event_id AND (e.status='published' OR public.is_event_manager()));
GRANT SELECT ON public.event_scoreboard TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_capacity integer; v_confirmed integer; v_next uuid; v_pos bigint;
BEGIN
 SELECT capacity INTO v_capacity FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO v_confirmed FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 WHILE v_confirmed < v_capacity LOOP
   SELECT r.id INTO v_next FROM public.registrations r JOIN public.events e ON e.id=r.event_id WHERE r.event_id=p_event_id AND r.status='waitlisted' AND NOT EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=r.user_id AND (current_date BETWEEN s.starts_on AND s.ends_on OR e.starts_at::date BETWEEN s.starts_on AND s.ends_on)) ORDER BY r.queue_position NULLS LAST, r.created_at, r.id LIMIT 1 FOR UPDATE OF r;
   EXIT WHEN v_next IS NULL;
   UPDATE public.registrations SET status='confirmed', queue_position=NULL, updated_at=now() WHERE id=v_next;
   v_confirmed := v_confirmed + 1; v_next := NULL;
 END LOOP;
 WITH numbered AS (
   SELECT id, row_number() OVER (ORDER BY queue_position NULLS LAST, created_at, id) AS new_pos
   FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'
 ) UPDATE public.registrations r SET queue_position=n.new_pos, updated_at=now() FROM numbered n WHERE r.id=n.id;
END; $$;
REVOKE ALL ON FUNCTION public.promote_event_waitlist(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.on_registration_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.promote_event_waitlist(OLD.event_id); RETURN OLD; END IF;
 IF NEW.status='cancelled' AND OLD.status<>'cancelled' THEN PERFORM public.promote_event_waitlist(OLD.event_id); END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS promote_waitlist_after_withdrawal ON public.registrations;
DROP TRIGGER IF EXISTS promote_waitlist_after_delete ON public.registrations;
CREATE TRIGGER promote_waitlist_after_withdrawal AFTER UPDATE OF status ON public.registrations
 FOR EACH ROW EXECUTE FUNCTION public.on_registration_withdrawal();
CREATE TRIGGER promote_waitlist_after_delete AFTER DELETE ON public.registrations
 FOR EACH ROW EXECUTE FUNCTION public.on_registration_withdrawal();

CREATE OR REPLACE FUNCTION public.withdraw_from_event(p_registration_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_registration public.registrations%rowtype; v_event public.events%rowtype;
BEGIN
 SELECT * INTO v_registration FROM public.registrations WHERE id=p_registration_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=v_registration.event_id;
 IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN RAISE EXCEPTION 'The registration cutoff has passed; you can no longer withdraw.'; END IF;
 IF v_registration.status='cancelled' THEN RETURN; END IF;
 UPDATE public.registrations SET status='cancelled', queue_position=NULL, updated_at=now() WHERE id=p_registration_id;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_from_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_from_event(uuid) TO authenticated;

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
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_user_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Member is already registered or waitlisted'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions WHERE user_id=p_user_id AND (current_date BETWEEN starts_on AND ends_on OR v_event.starts_at::date BETWEEN starts_on AND ends_on)) THEN RAISE EXCEPTION 'This member is suspended for the event date'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count < v_event.capacity THEN v_status:='confirmed'; v_queue:=NULL;
 ELSE IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted'; v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
 VALUES(p_event_id,p_user_id,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
 ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,queue_position=EXCLUDED.queue_position,amount_cents=EXCLUDED.amount_cents,payment_status=EXCLUDED.payment_status,updated_at=now()
 RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_member_directory()
RETURNS TABLE(id uuid, full_name text, avatar_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.avatar_url FROM public.profiles p ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_member_directory() TO authenticated;

-- Keep the registration RPC secure and enforce cutoff, capacity, membership and suspension rules.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_event public.events%rowtype; v_count integer; v_status public.registration_status; v_queue bigint; v_id uuid; v_member boolean;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status<>'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
 IF now()<v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
 IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
 IF EXISTS(SELECT 1 FROM public.member_suspensions s WHERE s.user_id=v_user AND (current_date BETWEEN s.starts_on AND s.ends_on OR v_event.starts_at::date BETWEEN s.starts_on AND s.ends_on)) THEN RAISE EXCEPTION 'Your account is suspended for this period and cannot register for club events.'; END IF;
 IF v_event.members_only THEN
   SELECT EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=v_user AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date) AND (m.payment_status='paid' OR EXISTS(SELECT 1 FROM public.payments p WHERE p.membership_id=m.id AND p.status IN ('paid','recorded_manually')))) INTO v_member;
   IF NOT v_member THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=v_user AND status<>'cancelled') THEN RAISE EXCEPTION 'You are already registered or waitlisted'; END IF;
 SELECT count(*) INTO v_count FROM public.registrations WHERE event_id=p_event_id AND status='confirmed';
 IF v_count<v_event.capacity THEN v_status:='confirmed';v_queue:=NULL;
 ELSE IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and the waitlist is disabled'; END IF;
   SELECT coalesce(max(queue_position),0)+1 INTO v_queue FROM public.registrations WHERE event_id=p_event_id AND status='waitlisted';v_status:='waitlisted';
 END IF;
 INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
 VALUES(p_event_id,v_user,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
 ON CONFLICT(event_id,user_id) DO UPDATE SET status=EXCLUDED.status,queue_position=EXCLUDED.queue_position,amount_cents=EXCLUDED.amount_cents,payment_status=EXCLUDED.payment_status,updated_at=now()
 RETURNING id INTO v_id;
 RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

-- Do not allow organizers to manage news, members, club profile, memberships or payments.
-- Existing administrator-only policies remain in place for those areas.
-- END MIGRATION: 0009_event_management.sql
