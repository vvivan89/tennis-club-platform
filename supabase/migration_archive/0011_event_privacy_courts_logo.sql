-- BEGIN MIGRATION: 0011_event_privacy_courts_logo.sql
-- Court sub-sessions can extend beyond four; a court may repeat across sub-sessions.
ALTER TABLE public.event_court_assignments DROP CONSTRAINT IF EXISTS event_court_assignments_segment_order_check;
ALTER TABLE public.event_court_assignments ADD CONSTRAINT event_court_assignments_segment_order_check CHECK (segment_order >= 1);

-- Public club logo URL stored in Supabase Storage.
ALTER TABLE public.club_settings ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '';
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('club-assets','club-assets',true,5242880,ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880, allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'];
DROP POLICY IF EXISTS "Public read club assets" ON storage.objects;
CREATE POLICY "Public read club assets" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id='club-assets');
DROP POLICY IF EXISTS "Admins upload club assets" ON storage.objects;
CREATE POLICY "Admins upload club assets" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='club-assets' AND public.is_admin());
DROP POLICY IF EXISTS "Admins update club assets" ON storage.objects;
CREATE POLICY "Admins update club assets" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='club-assets' AND public.is_admin()) WITH CHECK (bucket_id='club-assets' AND public.is_admin());
DROP POLICY IF EXISTS "Admins delete club assets" ON storage.objects;
CREATE POLICY "Admins delete club assets" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='club-assets' AND public.is_admin());

-- Expose only aggregate capacity information publicly; never expose participant names in public queries.
CREATE OR REPLACE VIEW public.event_public_counts AS
SELECT e.id AS event_id, count(r.id) FILTER (WHERE r.status='confirmed')::integer AS confirmed_count
FROM public.events e LEFT JOIN public.registrations r ON r.event_id=e.id
GROUP BY e.id;
GRANT SELECT ON public.event_public_counts TO anon, authenticated;

CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position,
       r.created_at AS registered_at, p.full_name, p.avatar_url, p.tennis_skill_level
FROM public.registrations r
JOIN public.profiles p ON p.id=r.user_id
JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager())
  AND r.status IN ('confirmed','waitlisted')
  AND (
    public.is_event_manager() OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
      AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
        AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
    )
  );
GRANT SELECT ON public.event_roster TO anon, authenticated;

DROP POLICY IF EXISTS "Event participants read court assignments" ON public.event_court_assignments;
CREATE POLICY "Event participants read court assignments" ON public.event_court_assignments FOR SELECT TO authenticated
USING (
 public.is_event_manager() OR (
   EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_court_assignments.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
   AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
     AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
 )
);

DROP POLICY IF EXISTS "Published event scores readable" ON public.event_scores;
CREATE POLICY "Published event scores readable" ON public.event_scores FOR SELECT TO authenticated
USING (
 public.is_event_manager() OR (
   EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=event_scores.event_id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
   AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
     AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
 )
);
CREATE OR REPLACE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name,
       s.player_three_registration_id, s.player_four_registration_id,
       p3.full_name AS player_three_name, p4.full_name AS player_four_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
JOIN public.events e ON e.id=s.event_id
WHERE e.event_type<>'tournament' AND (e.status='published' OR public.is_event_manager())
 AND (public.is_event_manager() OR (
   EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
   AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.ends_on IS NULL OR m.ends_on>=current_date)
     AND (m.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments pay WHERE pay.membership_id=m.id AND pay.status IN ('paid','recorded_manually'))))
 ));
GRANT SELECT ON public.event_scoreboard TO authenticated;
REVOKE SELECT ON public.event_scoreboard FROM anon;

-- Tournament events must not accept scores, even through direct API calls.
DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated
WITH CHECK (
 entered_by=(SELECT auth.uid())
 AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.event_type<>'tournament')
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.status='confirmed' AND r.event_id=event_scores.event_id)
 AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')
 AND (player_three_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_three_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
 AND (player_four_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_four_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed'))
 AND (player_three_registration_id IS NULL OR player_three_registration_id<>player_one_registration_id)
 AND (player_four_registration_id IS NULL OR player_four_registration_id<>player_one_registration_id)
 AND (player_three_registration_id IS NULL OR player_three_registration_id<>player_two_registration_id)
 AND (player_four_registration_id IS NULL OR player_four_registration_id<>player_two_registration_id)
 AND (player_three_registration_id IS NULL OR player_four_registration_id IS NULL OR player_three_registration_id<>player_four_registration_id)
);
-- END MIGRATION: 0011_event_privacy_courts_logo.sql
