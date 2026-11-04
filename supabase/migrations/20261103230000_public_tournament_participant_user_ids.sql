-- Expose the participant's profile ID so standings can reuse the same public
-- identity data (avatar, rating, birthday indicator) as doubles displays.
CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  (p.user_id IS NOT NULL) AS is_member,false AS captain_requested,
  profile.avatar_url,
  (coalesce(profile.show_birthday_emoji,false)
    AND profile.date_of_birth IS NOT NULL
    AND to_char(profile.date_of_birth,'MM-DD') = to_char((now() AT TIME ZONE 'America/Vancouver')::date,'MM-DD'))
    AS birthday_emoji_visible,
  p.user_id
FROM public.tournament_participants p
JOIN public.events e ON e.id=p.event_id
LEFT JOIN public.profiles profile ON profile.id=p.user_id
WHERE e.status='published' AND p.status='registered' AND p.confirmation_status='confirmed'
  AND (p.user_id IS NULL OR (profile.application_status='approved' AND profile.account_kind='member')
    OR profile.account_kind='event_guest')
  AND (e.tournament_details_public=true
    OR EXISTS (SELECT 1 FROM public.profiles viewer WHERE viewer.id=auth.uid()
      AND viewer.application_status='approved' AND viewer.account_kind='member')
    OR (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tournament_participants own WHERE own.event_id=e.id
        AND own.user_id=auth.uid() AND own.status='registered'
    )));
GRANT SELECT ON public.tournament_public_participants TO anon,authenticated;
