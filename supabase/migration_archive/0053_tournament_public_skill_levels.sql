-- Expose tennis skill ratings on published tournament participant rows, without exposing contact data.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id, p.event_id, p.team_id, p.category, p.display_name,
       coalesce(p.gender_override, p.gender) AS gender, p.status,
       profile.tennis_skill_level
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered'
  AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournament_participants own
    WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
  )));

CREATE OR REPLACE VIEW public.tournament_public_pairs AS
SELECT p.id, p.event_id, p.category, p.player_one_id, p.player_two_id, p.group_number, p.seed, p.status,
       a.display_name AS player_one_name, b.display_name AS player_two_name,
       profile_a.tennis_skill_level AS player_one_skill_level,
       profile_b.tennis_skill_level AS player_two_skill_level
FROM public.tournament_pairs p
JOIN public.tournament_participants a ON a.id=p.player_one_id
JOIN public.tournament_participants b ON b.id=p.player_two_id
LEFT JOIN public.profiles profile_a ON profile_a.id=a.user_id
LEFT JOIN public.profiles profile_b ON profile_b.id=b.user_id
JOIN public.events e ON e.id=p.event_id
WHERE e.status='published' AND (e.tournament_details_public=true OR (auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.tournament_participants own
  WHERE own.event_id=e.id AND own.user_id=auth.uid() AND own.status='registered'
)));
