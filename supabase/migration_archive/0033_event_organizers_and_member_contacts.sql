-- BEGIN MIGRATION: 0033_event_organizers_and_member_contacts.sql
-- Preserve the event creator for permissions/audit, while allowing an admin to
-- assign a separate event organizer.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.events e
SET organizer_id = e.created_by
WHERE e.organizer_id IS NULL
  AND e.created_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = e.created_by);

CREATE INDEX IF NOT EXISTS events_organizer_id_idx ON public.events (organizer_id);

CREATE OR REPLACE FUNCTION public.validate_event_organizer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.organizer_id IS NULL THEN
    NEW.organizer_id := NEW.created_by;
  END IF;

  IF NEW.organizer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.organizer_id AND p.role IN ('admin', 'organizer')
  ) THEN
    RAISE EXCEPTION 'Event organizer must be an administrator or organizer';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (
    NEW.organizer_id IS DISTINCT FROM auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only administrators can assign another event organizer' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_event_organizer ON public.events;
CREATE TRIGGER validate_event_organizer
BEFORE INSERT OR UPDATE OF organizer_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.validate_event_organizer();

-- Organizer names and private contact information are returned only to
-- approved members who have paid a membership fee at least once.
CREATE OR REPLACE FUNCTION public.event_organizer_contacts(p_event_id uuid)
RETURNS TABLE(
  organizer_id uuid,
  organizer_name text,
  "position" text,
  emails text[],
  phones text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_ever_paid_membership(auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    coalesce(nullif(p.full_name, ''), p.email),
    coalesce(cc.position, CASE WHEN p.role = 'organizer' THEN 'Event organizer' ELSE 'Club administrator' END),
    coalesce(nullif(cc.emails, ARRAY[]::text[]), ARRAY[p.email]::text[]),
    coalesce(nullif(cc.phones, ARRAY[]::text[]), ARRAY[p.phone]::text[])
  FROM public.events e
  JOIN public.profiles p ON p.id = coalesce(e.organizer_id, e.created_by)
  LEFT JOIN public.club_contacts cc ON cc.profile_id = p.id
  WHERE e.id = p_event_id AND e.status IN ('published', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.event_organizer_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_organizer_contacts(uuid) TO authenticated;
-- END MIGRATION: 0033_event_organizers_and_member_contacts.sql
