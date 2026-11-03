-- BEGIN MIGRATION: 0024_family_membership_event_eligibility.sql
-- Keep event eligibility consistent with the Membership dashboard: a paid family plan
-- covers each confirmed family member, even if that member's individual membership row
-- is marked unpaid. A member scheduled to leave next season remains covered this season.
CREATE OR REPLACE FUNCTION public.has_active_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = v_user
        AND m.status = 'active'
        AND (m.ends_on IS NULL OR m.ends_on >= current_date)
        AND (
          m.payment_status = 'paid'
          OR EXISTS (
            SELECT 1 FROM public.payments p
            WHERE p.membership_id = m.id
              AND p.status IN ('paid', 'recorded_manually')
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.membership_family_members fm
      JOIN public.membership_families f ON f.id = fm.family_id
      WHERE fm.user_id = v_user
        AND fm.status IN ('confirmed', 'removed_next_season')
        AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
    );
$$;
REVOKE ALL ON FUNCTION public.has_active_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_paid_membership(uuid) TO authenticated;

-- Registration now recognises a paid family membership as well as a paid individual plan.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS table(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.application_status='approved') THEN
    RAISE EXCEPTION 'Your registration is pending administrator approval.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status<>'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
  IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN
    RAISE EXCEPTION 'Registration is unavailable for events that have already started';
  END IF;
  IF now()<v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now()>=v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_suspensions s
    WHERE s.user_id=v_user
      AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on
      AND s.cancelled_at IS NULL
  ) THEN RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(v_user) THEN
    RAISE EXCEPTION 'An active, paid membership is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id=p_event_id AND r.user_id=v_user AND r.status<>'cancelled') THEN
    RAISE EXCEPTION 'You are already registered or waitlisted';
  END IF;
  SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='confirmed';
  IF v_count<v_event.capacity THEN
    v_status:='confirmed'; v_queue:=NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(r.queue_position),0)+1 INTO v_queue FROM public.registrations r WHERE r.event_id=p_event_id AND r.status='waitlisted';
    v_status:='waitlisted';
  END IF;
  INSERT INTO public.registrations(event_id,user_id,status,queue_position,amount_cents,payment_status)
  VALUES(p_event_id,v_user,v_status,v_queue,v_event.price_cents,CASE WHEN v_event.price_cents=0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id,v_status,v_queue;
END; $$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

-- Participant replacement uses the same membership entitlement rule as self-registration.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_reg uuid;
  v_event public.events%rowtype;
  v_new_profile public.profiles%rowtype;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT id INTO old_reg FROM public.registrations
    WHERE event_id=p_event_id AND user_id=p_old_user_id AND status IN ('confirmed','waitlisted')
    LIMIT 1 FOR UPDATE;
  IF old_reg IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id) THEN
    RAISE EXCEPTION 'The selected member has a previous registration for this event. Choose a member who has never registered for this session.';
  END IF;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id=p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN
    RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.';
  END IF;
  UPDATE public.registrations SET user_id=p_new_user_id, updated_at=now() WHERE id=old_reg;
END; $$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;

-- Family members who are registered may read the same roster, court assignments and scores as individually paid members.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id,r.event_id,r.user_id,r.status,r.queue_position,r.created_at AS registered_at,p.full_name,p.avatar_url,p.tennis_skill_level
FROM public.registrations r JOIN public.profiles p ON p.id=r.user_id JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager())
  AND r.status IN ('confirmed','waitlisted')
  AND (public.is_event_manager() OR (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
    AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  ));
GRANT SELECT ON public.event_roster TO anon,authenticated;

CREATE OR REPLACE VIEW public.event_scoreboard AS
SELECT s.id,s.event_id,s.player_one_registration_id,s.player_two_registration_id,s.player_one_score,s.player_two_score,s.played_at,
 p1.full_name AS player_one_name,p2.full_name AS player_two_name,s.player_three_registration_id,s.player_four_registration_id,
 p3.full_name AS player_three_name,p4.full_name AS player_four_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
JOIN public.events e ON e.id=s.event_id
WHERE e.event_type<>'tournament' AND (e.status='published' OR public.is_event_manager())
  AND (public.is_event_manager() OR (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
    AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  ));
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

-- The same family entitlement must allow registered family members to read court assignments and scores.
DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments FOR SELECT TO authenticated
USING (
  public.is_event_manager() OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_court_assignments.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  )
);
DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores FOR SELECT TO authenticated
USING (
  public.is_event_manager() OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_scores.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.has_active_paid_membership((SELECT auth.uid()))
  )
);
-- END MIGRATION: 0024_family_membership_event_eligibility.sql
