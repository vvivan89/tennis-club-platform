-- BEGIN MIGRATION: 0036_chat_member_display_names.sql
-- Expose only the minimum member directory fields needed by approved-member chat.
-- This avoids broadening direct SELECT access to the profiles table.
CREATE OR REPLACE FUNCTION public.get_member_chat_member_names()
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Member') AS full_name
  FROM public.profiles AS p
  WHERE p.application_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS caller
      WHERE caller.id = (SELECT auth.uid())
        AND caller.application_status = 'approved'
    )
  ORDER BY COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Member');
$$;
REVOKE ALL ON FUNCTION public.get_member_chat_member_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_chat_member_names() TO authenticated;
-- Chat remains excluded from audit logging.
-- END MIGRATION: 0036_chat_member_display_names.sql
