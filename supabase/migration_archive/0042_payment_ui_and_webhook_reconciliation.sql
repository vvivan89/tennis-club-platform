-- Expose payment state on the event roster so unpaid reservations are displayed as pending.
-- Keep the existing roster visibility rules unchanged.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT
  r.id AS registration_id,
  r.event_id,
  r.user_id,
  r.status,
  r.queue_position,
  r.created_at AS registered_at,
  p.full_name,
  p.avatar_url,
  p.tennis_skill_level,
  r.payment_status
FROM public.registrations r
JOIN public.profiles p ON p.id = r.user_id
JOIN public.events e ON e.id = r.event_id
WHERE (e.status = 'published' OR public.is_event_manager())
  AND r.status IN ('confirmed', 'waitlisted')
  AND (
    public.is_event_manager()
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.profiles me
        WHERE me.id = (SELECT auth.uid())
          AND me.application_status = 'approved'
      )
      AND EXISTS (
        SELECT 1
        FROM public.registrations own
        WHERE own.event_id = e.id
          AND own.user_id = (SELECT auth.uid())
          AND own.status IN ('confirmed', 'waitlisted')
      )
      AND public.current_user_has_active_paid_membership()
    )
  );
GRANT SELECT ON public.event_roster TO anon, authenticated;
