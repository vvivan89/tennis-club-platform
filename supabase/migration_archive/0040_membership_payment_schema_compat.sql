-- Reconcile membership eligibility helpers with the Stripe payments schema.
-- The payments foundation stores the related business row in business_record_id
-- and uses 'succeeded' instead of the legacy 'paid'/'recorded_manually' statuses.
-- Keep memberships.payment_status and family-plan coverage as valid fallbacks.

CREATE OR REPLACE FUNCTION public.is_paid_member()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.status = 'active'
      AND (
        m.payment_status = 'paid'
        OR EXISTS (
          SELECT 1
          FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status = 'succeeded'
        )
      )
      AND (m.starts_on IS NULL OR m.starts_on <= current_date)
      AND (m.ends_on IS NULL OR m.ends_on >= current_date)
  );
$$;
-- Preserve the original public execute grant: public_club_contacts also calls this
-- boolean helper for anonymous visitors, for whom auth.uid() is NULL.
GRANT EXECUTE ON FUNCTION public.is_paid_member() TO PUBLIC;

CREATE OR REPLACE FUNCTION public.has_ever_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.memberships m ON m.user_id = pr.id
    WHERE pr.id = v_user
      AND pr.application_status = 'approved'
      AND (
        m.payment_status = 'paid'
        OR EXISTS (
          SELECT 1
          FROM public.payments p
          WHERE p.purpose = 'membership'
            AND p.business_record_id = m.id::text
            AND p.status = 'succeeded'
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_ever_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ever_paid_membership(uuid) TO authenticated;

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
            SELECT 1
            FROM public.payments p
            WHERE p.purpose = 'membership'
              AND p.business_record_id = m.id::text
              AND p.status = 'succeeded'
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
