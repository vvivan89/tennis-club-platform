-- Public tournament pages fetch organizer contact details only after a visitor
-- explicitly selects "Show contacts". The initial public page receives names only.
CREATE OR REPLACE FUNCTION public.event_public_tournament_organizer_contact_details(p_event_id uuid)
RETURNS TABLE(
  organizer_id uuid,
  organizer_name text,
  "position" text,
  emails text[],
  phones text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    p.id,
    coalesce(nullif(p.full_name, ''), 'Event organizer'),
    coalesce(cc.position, CASE WHEN p.role = 'organizer' THEN 'Event organizer' ELSE 'Club administrator' END),
    CASE WHEN cc.emails IS NOT NULL AND cardinality(cc.emails) > 0 THEN cc.emails WHEN p.email IS NOT NULL THEN ARRAY[p.email]::text[] ELSE ARRAY[]::text[] END,
    CASE WHEN cc.phones IS NOT NULL AND cardinality(cc.phones) > 0 THEN cc.phones WHEN p.phone IS NOT NULL THEN ARRAY[p.phone]::text[] ELSE ARRAY[]::text[] END
  FROM public.events e
  JOIN public.profiles p ON p.id = coalesce(e.organizer_id, e.created_by)
  LEFT JOIN public.club_contacts cc ON cc.profile_id = p.id
  WHERE e.id = p_event_id AND e.event_type = 'tournament' AND e.status = 'published';
$$;
REVOKE ALL ON FUNCTION public.event_public_tournament_organizer_contact_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_public_tournament_organizer_contact_details(uuid) TO anon, authenticated;
