-- BEGIN MIGRATION: 0034_member_group_chat.sql
-- Single shared group chat for approved club members.
CREATE TABLE IF NOT EXISTS public.member_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT member_chat_message_content CHECK (
    (length(btrim(body)) > 0 OR image_path IS NOT NULL)
    AND length(body) <= 4000
  )
);
CREATE INDEX IF NOT EXISTS member_chat_messages_created_idx
  ON public.member_chat_messages (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS member_chat_messages_user_idx
  ON public.member_chat_messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.member_chat_reads (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_chat_messages, public.member_chat_reads FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.member_chat_reads TO authenticated;

DROP POLICY IF EXISTS "Approved members can read chat messages" ON public.member_chat_messages;
CREATE POLICY "Approved members can read chat messages"
  ON public.member_chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Approved members can send chat messages" ON public.member_chat_messages;
CREATE POLICY "Approved members can send chat messages"
  ON public.member_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved')
  );
DROP POLICY IF EXISTS "Authors can update own recent chat messages" ON public.member_chat_messages;
CREATE POLICY "Authors can update own recent chat messages"
  ON public.member_chat_messages FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND created_at >= now() - interval '5 minutes'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'))
  WITH CHECK (user_id = (SELECT auth.uid()) AND created_at >= now() - interval '5 minutes');
DROP POLICY IF EXISTS "Authors can delete own recent chat messages" ON public.member_chat_messages;
CREATE POLICY "Authors can delete own recent chat messages"
  ON public.member_chat_messages FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND created_at >= now() - interval '5 minutes'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));

DROP POLICY IF EXISTS "Members can read own chat read marker" ON public.member_chat_reads;
CREATE POLICY "Members can read own chat read marker" ON public.member_chat_reads FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Members can insert own chat read marker" ON public.member_chat_reads;
CREATE POLICY "Members can insert own chat read marker" ON public.member_chat_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Members can update own chat read marker" ON public.member_chat_reads;
CREATE POLICY "Members can update own chat read marker" ON public.member_chat_reads FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_member_chat_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Chat messages must be sent as the authenticated user' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := NULL;
    NEW.deleted_at := NULL;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
      OR OLD.image_path IS DISTINCT FROM NEW.image_path OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      RAISE EXCEPTION 'Only chat message text can be edited';
    END IF;
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_member_chat_message ON public.member_chat_messages;
CREATE TRIGGER guard_member_chat_message BEFORE INSERT OR UPDATE OR DELETE ON public.member_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_member_chat_message();

CREATE OR REPLACE FUNCTION public.trim_member_chat_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Keep the newest 2,000 messages in the single shared conversation.
  DELETE FROM public.member_chat_messages
  WHERE id IN (
    SELECT id FROM public.member_chat_messages
    ORDER BY created_at DESC, id DESC
    OFFSET 2000
  );
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trim_member_chat_history ON public.member_chat_messages;
CREATE TRIGGER trim_member_chat_history AFTER INSERT ON public.member_chat_messages
FOR EACH STATEMENT EXECUTE FUNCTION public.trim_member_chat_history();

-- Restrict the public bucket to small images uploaded by approved members.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('member-chat-images', 'member-chat-images', false, 1048576, ARRAY['image/jpeg','image/png','image/gif','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 1048576,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/gif','image/webp'];
DROP POLICY IF EXISTS "Approved members can read chat images" ON storage.objects;
CREATE POLICY "Approved members can read chat images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'member-chat-images' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Approved members can upload own chat images" ON storage.objects;
CREATE POLICY "Approved members can upload own chat images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'member-chat-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved')
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','gif','webp'));
DROP POLICY IF EXISTS "Members can delete own chat images" ON storage.objects;
CREATE POLICY "Members can delete own chat images" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'member-chat-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'));

-- Realtime delivers committed inserts/updates/deletes; chat is intentionally excluded from audit logging.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
WHEN undefined_object THEN NULL;
END $$;
-- END MIGRATION: 0034_member_group_chat.sql
