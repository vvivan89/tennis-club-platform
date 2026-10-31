-- Allow members and managers to update their own profile fields, and limit score
-- editing/deletion to admins and the user who entered the score.
BEGIN;

DROP POLICY IF EXISTS "Members update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Managers may still enter scores for any assigned court/player combination.
DROP POLICY IF EXISTS "Event managers manage scores" ON public.event_scores;
DROP POLICY IF EXISTS "Event managers insert scores" ON public.event_scores;
CREATE POLICY "Event managers insert scores" ON public.event_scores FOR INSERT TO authenticated
  WITH CHECK (public.is_event_manager());

DROP POLICY IF EXISTS "Admins edit recent scores" ON public.event_scores;
CREATE POLICY "Admins edit recent scores" ON public.event_scores FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_scores.event_id AND e.starts_at >= now() - interval '2 days'
    )
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_scores.event_id AND e.starts_at >= now() - interval '2 days'
    )
  );

DROP POLICY IF EXISTS "Admins and score authors delete recent scores" ON public.event_scores;
CREATE POLICY "Admins and score authors delete recent scores" ON public.event_scores FOR DELETE TO authenticated
  USING (
    (public.is_admin() OR entered_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_scores.event_id AND e.starts_at >= now() - interval '2 days'
    )
  );

GRANT UPDATE, DELETE ON public.event_scores TO authenticated;
COMMIT;
