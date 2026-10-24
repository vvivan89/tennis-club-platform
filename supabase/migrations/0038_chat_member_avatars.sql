-- Expose only approved members' avatar URLs to the approved-member chat.
-- Direct profile-table access is intentionally not broadened.
CREATE OR REPLACE FUNCTION public.get_member_chat_member_avatars(p_user_ids uuid[])
RETURNS TABLE (id uuid, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.avatar_url
  FROM public.profiles AS p
  WHERE p.id = ANY(p_user_ids)
    AND p.application_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS caller
      WHERE caller.id = (SELECT auth.uid())
        AND caller.application_status = 'approved'
    );
$$;
REVOKE ALL ON FUNCTION public.get_member_chat_member_avatars(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_chat_member_avatars(uuid[]) TO authenticated;
-- Chat remains excluded from audit logging.
