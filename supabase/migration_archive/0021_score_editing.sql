-- BEGIN MIGRATION: 0021_score_editing.sql
-- Expose the score author to the authenticated event page so players can edit scores they entered.
CREATE OR REPLACE VIEW public.event_scoreboard AS
SELECT s.id,s.event_id,s.player_one_registration_id,s.player_two_registration_id,s.player_one_score,s.player_two_score,s.played_at,
 p1.full_name AS player_one_name,p2.full_name AS player_two_name,s.player_three_registration_id,s.player_four_registration_id,
 p3.full_name AS player_three_name,p4.full_name AS player_four_name,s.entered_by
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id JOIN public.profiles p1 ON p1.id=r1.user_id
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

DROP POLICY IF EXISTS "Participants edit their recent scores" ON public.event_scores;
CREATE POLICY "Participants edit their recent scores" ON public.event_scores FOR UPDATE TO authenticated
USING (
 entered_by=(SELECT auth.uid())
 AND EXISTS(SELECT 1 FROM public.registrations r WHERE r.id=event_scores.player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.event_id=event_scores.event_id)
 AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.starts_at >= now()-interval '2 days')
)
WITH CHECK (
 entered_by=(SELECT auth.uid())
 AND EXISTS(SELECT 1 FROM public.registrations r WHERE r.id=event_scores.player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.event_id=event_scores.event_id)
 AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_scores.event_id AND e.starts_at >= now()-interval '2 days')
);
-- END MIGRATION: 0021_score_editing.sql
