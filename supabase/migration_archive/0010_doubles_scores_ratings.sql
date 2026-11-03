-- BEGIN MIGRATION: 0010_doubles_scores_ratings.sql
-- Doubles score partners, participant ratings in event roster, and series-wide shared-field edits.
ALTER TABLE public.event_scores
  ADD COLUMN IF NOT EXISTS player_three_registration_id uuid REFERENCES public.registrations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS player_four_registration_id uuid REFERENCES public.registrations(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Participants enter scores" ON public.event_scores;
CREATE POLICY "Participants enter scores" ON public.event_scores FOR INSERT TO authenticated
WITH CHECK (
  entered_by=(SELECT auth.uid()) AND
  EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_one_registration_id AND r.user_id=(SELECT auth.uid()) AND r.status='confirmed' AND r.event_id=event_scores.event_id) AND
  EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_two_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed') AND
  (player_three_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_three_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')) AND
  (player_four_registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=player_four_registration_id AND r.event_id=event_scores.event_id AND r.status='confirmed')) AND
  (player_three_registration_id IS NULL OR player_three_registration_id <> player_one_registration_id) AND
  (player_four_registration_id IS NULL OR player_four_registration_id <> player_one_registration_id) AND
  (player_three_registration_id IS NULL OR player_three_registration_id <> player_two_registration_id) AND
  (player_four_registration_id IS NULL OR player_four_registration_id <> player_two_registration_id) AND
  (player_three_registration_id IS NULL OR player_four_registration_id IS NULL OR player_three_registration_id <> player_four_registration_id)
);

CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id, r.event_id, r.user_id, r.status, r.queue_position,
       r.created_at AS registered_at, p.full_name, p.avatar_url, p.tennis_skill_level
FROM public.registrations r
JOIN public.profiles p ON p.id=r.user_id
JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager()) AND r.status IN ('confirmed','waitlisted');
GRANT SELECT ON public.event_roster TO anon, authenticated;

CREATE OR REPLACE VIEW public.event_scoreboard AS
SELECT s.id, s.event_id, s.player_one_registration_id, s.player_two_registration_id,
       s.player_one_score, s.player_two_score, s.played_at,
       p1.full_name AS player_one_name, p2.full_name AS player_two_name,
       s.player_three_registration_id, s.player_four_registration_id,
       p3.full_name AS player_three_name, p4.full_name AS player_four_name
FROM public.event_scores s
JOIN public.registrations r1 ON r1.id=s.player_one_registration_id
JOIN public.profiles p1 ON p1.id=r1.user_id
JOIN public.registrations r2 ON r2.id=s.player_two_registration_id
JOIN public.profiles p2 ON p2.id=r2.user_id
LEFT JOIN public.registrations r3 ON r3.id=s.player_three_registration_id
LEFT JOIN public.profiles p3 ON p3.id=r3.user_id
LEFT JOIN public.registrations r4 ON r4.id=s.player_four_registration_id
LEFT JOIN public.profiles p4 ON p4.id=r4.user_id
WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.id=s.event_id AND (e.status='published' OR public.is_event_manager()));
GRANT SELECT ON public.event_scoreboard TO anon, authenticated;
-- END MIGRATION: 0010_doubles_scores_ratings.sql
