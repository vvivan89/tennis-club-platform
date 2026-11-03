-- Record waiver acceptance for each person covered by a family membership.
ALTER TABLE public.membership_family_members
  ADD COLUMN IF NOT EXISTS waiver_version text,
  ADD COLUMN IF NOT EXISTS waiver_accepted_at timestamptz;

-- Fulfill paid business records only after the Stripe webhook has marked the
-- internal payment succeeded. This is idempotent and callable only by service_role.
CREATE OR REPLACE FUNCTION public.fulfill_successful_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.payments%rowtype;
  v_membership_id uuid;
  v_registration_id uuid;
  v_family_id uuid;
  v_updated integer;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found';
  END IF;
  IF v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Only succeeded payments can be fulfilled';
  END IF;

  IF v_payment.purpose = 'membership' THEN
    IF v_payment.business_record_id LIKE 'family:%' THEN
      IF substring(v_payment.business_record_id FROM 8) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid family reference on payment';
      END IF;
      v_family_id := substring(v_payment.business_record_id FROM 8)::uuid;
      UPDATE public.membership_families
      SET paid_at = COALESCE(paid_at, now()),
          paid_by = COALESCE(paid_by, v_payment.user_id),
          payment_id = COALESCE(payment_id, v_payment.id)
      WHERE id = v_family_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    ELSIF v_payment.business_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_membership_id := v_payment.business_record_id::uuid;
      UPDATE public.memberships
      SET status = 'active', payment_status = 'paid', updated_at = now()
      WHERE id = v_membership_id AND user_id = v_payment.user_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 1 THEN RETURN; END IF;
    END IF;
    RAISE EXCEPTION 'Membership or family record was not found for payment';
  ELSIF v_payment.purpose = 'event_registration' THEN
    IF v_payment.business_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid registration reference on payment';
    END IF;
    v_registration_id := v_payment.business_record_id::uuid;
    UPDATE public.registrations r
    SET payment_status = 'paid',
        payment_provider = 'stripe',
        provider_reference = COALESCE(v_payment.stripe_payment_intent_id, v_payment.stripe_checkout_session_id),
        updated_at = now()
    FROM public.events e
    WHERE r.id = v_registration_id
      AND r.event_id = e.id
      AND r.user_id = v_payment.user_id
      AND r.status = 'confirmed'
      AND r.amount_cents = v_payment.amount_minor
      AND e.price_cents = v_payment.amount_minor
      AND r.payment_status IN ('pending', 'failed', 'paid');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.registrations WHERE id = v_registration_id AND user_id = v_payment.user_id AND payment_status = 'paid') THEN RETURN; END IF;
    RAISE EXCEPTION 'Confirmed registration does not match the successful payment';
  ELSE
    RAISE EXCEPTION 'Unsupported payment purpose for fulfillment';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_successful_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_successful_payment(uuid) TO service_role;

-- Prevent concurrent checkout attempts from creating multiple active charges for
-- the same membership/family or event registration. Failed/canceled attempts may retry.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_business_payment_uidx
  ON public.payments(purpose, business_record_id)
  WHERE business_record_id IS NOT NULL
    AND status IN ('pending', 'processing', 'succeeded', 'partially_refunded', 'refunded');

-- Safe no-argument wrapper for a view that is also readable by anon. It only
-- evaluates the caller's own membership and does not expose arbitrary user IDs.
CREATE OR REPLACE FUNCTION public.current_user_has_active_paid_membership()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.has_active_paid_membership((SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.current_user_has_active_paid_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_active_paid_membership() TO anon, authenticated;

-- Rebuild views and policies that were originally written against the legacy payment foreign key. These use the canonical eligibility helper.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position,
       r.created_at AS registered_at, p.full_name, p.avatar_url, p.tennis_skill_level
FROM public.registrations r
JOIN public.profiles p ON p.id = r.user_id
JOIN public.events e ON e.id = r.event_id
WHERE (e.status = 'published' OR public.is_event_manager())
  AND r.status IN ('confirmed', 'waitlisted')
  AND (
    public.is_event_manager()
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = (SELECT auth.uid()) AND me.application_status = 'approved')
      AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = e.id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
      AND public.current_user_has_active_paid_membership()
    )
  );
GRANT SELECT ON public.event_roster TO anon, authenticated;

CREATE OR REPLACE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name,
       s.player_three_registration_id, s.player_four_registration_id,
       p3.full_name AS player_three_name, p4.full_name AS player_four_name, s.entered_by
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id = s.player_one_registration_id
JOIN public.profiles p1 ON p1.id = r1.user_id
JOIN public.registrations r2 ON r2.id = s.player_two_registration_id
JOIN public.profiles p2 ON p2.id = r2.user_id
LEFT JOIN public.registrations r3 ON r3.id = s.player_three_registration_id
LEFT JOIN public.profiles p3 ON p3.id = r3.user_id
LEFT JOIN public.registrations r4 ON r4.id = s.player_four_registration_id
LEFT JOIN public.profiles p4 ON p4.id = r4.user_id
JOIN public.events e ON e.id = s.event_id
WHERE e.event_type <> 'tournament'
  AND (e.status = 'published' OR public.is_event_manager())
  AND (
    public.is_event_manager()
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = (SELECT auth.uid()) AND me.application_status = 'approved')
      AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = e.id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
      AND public.current_user_has_active_paid_membership()
    )
  );
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments
FOR SELECT TO authenticated USING (
  public.is_event_manager()
  OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = event_court_assignments.event_id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
    AND public.current_user_has_active_paid_membership()
  )
);

DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores
FOR SELECT TO authenticated USING (
  public.is_event_manager()
  OR (
    EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id = event_scores.event_id AND own.user_id = (SELECT auth.uid()) AND own.status IN ('confirmed', 'waitlisted'))
    AND public.current_user_has_active_paid_membership()
  )
);

CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_reg uuid;
  v_event public.events%rowtype;
  v_new_profile public.profiles%rowtype;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT id INTO old_reg FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_old_user_id AND status IN ('confirmed', 'waitlisted')
    LIMIT 1 FOR UPDATE;
  IF old_reg IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event_id AND user_id = p_new_user_id) THEN
    RAISE EXCEPTION 'The selected member has a previous registration for this event. Choose a member who has never registered for this session.';
  END IF;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id = p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN
    RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.';
  END IF;
  UPDATE public.registrations SET user_id = p_new_user_id, updated_at = now() WHERE id = old_reg;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid, uuid, uuid) TO authenticated;

-- Resolve the club's current season consistently for individual and family eligibility.
CREATE OR REPLACE FUNCTION public.current_membership_season_year()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH settings AS (
    SELECT
      COALESCE((SELECT season_start_month FROM public.membership_plan_settings WHERE id = 1), 4) AS start_month,
      COALESCE((SELECT season_start_day FROM public.membership_plan_settings WHERE id = 1), 1) AS start_day,
      COALESCE((SELECT season_end_month FROM public.membership_plan_settings WHERE id = 1), 9) AS end_month,
      COALESCE((SELECT season_end_day FROM public.membership_plan_settings WHERE id = 1), 30) AS end_day,
      EXTRACT(YEAR FROM current_date)::integer AS year,
      EXTRACT(MONTH FROM current_date)::integer * 100 + EXTRACT(DAY FROM current_date)::integer AS today_key
  )
  SELECT CASE
    WHEN today_key < start_month * 100 + start_day THEN year
    WHEN today_key > end_month * 100 + end_day THEN year + 1
    ELSE year
  END
  FROM settings;
$$;
REVOKE ALL ON FUNCTION public.current_membership_season_year() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_paid_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
        AND (m.payment_status = 'paid' OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
        ))
        AND (m.starts_on IS NULL OR m.starts_on <= current_date)
        AND (m.ends_on IS NULL OR m.ends_on >= current_date)
    )
    OR EXISTS (
      SELECT 1
      FROM public.membership_family_members fm
      JOIN public.membership_families f ON f.id = fm.family_id
      WHERE fm.user_id = (SELECT auth.uid())
        AND fm.status IN ('confirmed', 'removed_next_season')
        AND f.season_year = public.current_membership_season_year()
        AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
    );
$$;
GRANT EXECUTE ON FUNCTION public.is_paid_member() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.has_ever_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.id = v_user
      AND pr.application_status = 'approved'
      AND (
        EXISTS (
          SELECT 1 FROM public.memberships m
          WHERE m.user_id = pr.id
            AND (m.payment_status = 'paid' OR EXISTS (
              SELECT 1 FROM public.payments p
              WHERE p.purpose = 'membership'
                AND p.business_record_id = m.id::text
                AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
            ))
        )
        OR EXISTS (
          SELECT 1
          FROM public.membership_family_members fm
          JOIN public.membership_families f ON f.id = fm.family_id
          WHERE fm.user_id = pr.id
            AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_ever_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ever_paid_membership(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_active_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = v_user
        AND m.status = 'active'
        AND (m.starts_on IS NULL OR m.starts_on <= current_date)
        AND (m.ends_on IS NULL OR m.ends_on >= current_date)
        AND (m.payment_status = 'paid' OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
        ))
    )
    OR EXISTS (
      SELECT 1
      FROM public.membership_family_members fm
      JOIN public.membership_families f ON f.id = fm.family_id
      WHERE fm.user_id = v_user
        AND fm.status IN ('confirmed', 'removed_next_season')
        AND f.season_year = public.current_membership_season_year()
        AND (f.paid_at IS NOT NULL OR f.payment_id IS NOT NULL)
    );
$$;
REVOKE ALL ON FUNCTION public.has_active_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_paid_membership(uuid) TO authenticated;
