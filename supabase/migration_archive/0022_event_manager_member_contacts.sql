-- BEGIN MIGRATION: 0022_event_manager_member_contacts.sql
-- Event managers need contact details to coordinate participants. The function remains
-- restricted to approved event managers; it is not granted to anon/PUBLIC.
DROP FUNCTION IF EXISTS public.event_member_directory();
CREATE FUNCTION public.event_member_directory()
RETURNS TABLE(id uuid, full_name text, avatar_url text, email text, phone text, tennis_skill_level text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
 RETURN QUERY SELECT p.id,p.full_name,p.avatar_url,p.email,p.phone,p.tennis_skill_level::text
 FROM public.profiles p ORDER BY p.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.event_member_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_member_directory() TO authenticated;
-- END MIGRATION: 0022_event_manager_member_contacts.sql
