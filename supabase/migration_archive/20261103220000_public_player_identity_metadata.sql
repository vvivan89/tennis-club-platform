-- Expose only the opt-in birthday indicator, never the date of birth itself.
CREATE OR REPLACE VIEW public.event_roster AS
SELECT r.id AS registration_id,r.event_id,r.user_id,r.status,r.queue_position,
  r.created_at AS registered_at,p.full_name,p.avatar_url,p.tennis_skill_level,r.payment_status,
  (coalesce(p.show_birthday_emoji,false)
    AND p.date_of_birth IS NOT NULL
    AND to_char(p.date_of_birth,'MM-DD') = to_char((now() AT TIME ZONE 'America/Vancouver')::date,'MM-DD'))
    AS birthday_emoji_visible
FROM public.registrations r
JOIN public.profiles p ON p.id=r.user_id
JOIN public.events e ON e.id=r.event_id
WHERE (e.status='published' OR public.is_event_manager())
  AND r.status IN ('confirmed','waitlisted')
  AND (public.is_event_manager() OR (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id=(SELECT auth.uid()) AND me.application_status='approved')
    AND EXISTS (SELECT 1 FROM public.registrations own WHERE own.event_id=e.id AND own.user_id=(SELECT auth.uid()) AND own.status IN ('confirmed','waitlisted'))
    AND public.current_user_has_active_paid_membership()
  ));
GRANT SELECT ON public.event_roster TO anon,authenticated;

CREATE OR REPLACE VIEW public.tournament_public_participants AS
SELECT p.id,p.event_id,p.team_id,p.category,p.display_name,
  coalesce(p.gender_override,p.gender) AS gender,p.status,
  coalesce(p.tennis_skill_level::text,profile.tennis_skill_level) AS tennis_skill_level,
  (p.user_id IS NOT NULL) AS is_member,false AS captain_requested,
  profile.avatar_url,
  (coalesce(profile.show_birthday_emoji,false)
    AND profile.date_of_birth IS NOT NULL
    AND to_char(profile.date_of_birth,'MM-DD') = to_char((now() AT TIME ZONE 'America/Vancouver')::date,'MM-DD'))
    AS birthday_emoji_visible
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

-- Manager-only directory: expose the same opt-in, date-qualified indicator.
DROP FUNCTION public.event_member_directory(uuid);
CREATE FUNCTION public.event_member_directory(p_event_id uuid)
RETURNS TABLE(id uuid,full_name text,avatar_url text,email text,phone text,
  tennis_skill_level text,suspended boolean,birthday_emoji_visible boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_day date;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  SELECT (e.starts_at AT TIME ZONE 'America/Vancouver')::date INTO v_event_day
  FROM public.events e WHERE e.id=p_event_id;
  IF v_event_day IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
  RETURN QUERY
  SELECT p.id,p.full_name,p.avatar_url,p.email,p.phone,p.tennis_skill_level::text,
    EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id=p.id AND s.cancelled_at IS NULL
      AND v_event_day BETWEEN s.starts_on AND s.ends_on),
    (coalesce(p.show_birthday_emoji,false) AND p.date_of_birth IS NOT NULL
      AND to_char(p.date_of_birth,'MM-DD')=to_char((now() AT TIME ZONE 'America/Vancouver')::date,'MM-DD'))
  FROM public.profiles p
  WHERE p.application_status='approved' AND p.account_kind='member'
  ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_member_directory(uuid) TO authenticated;
