-- Keep chat presence connected across the member portal, bound unread-count queries,
-- and queue storage objects for deletion whenever their messages are deleted/pruned.
ALTER TABLE public.member_chat_reads
  ADD COLUMN IF NOT EXISTS last_read_message_id uuid;

CREATE INDEX IF NOT EXISTS member_chat_messages_unread_idx
  ON public.member_chat_messages (created_at, id, user_id);

CREATE OR REPLACE FUNCTION public.get_member_chat_unread_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.member_chat_messages AS m
  LEFT JOIN public.member_chat_reads AS r ON r.user_id = (SELECT auth.uid())
  WHERE m.user_id <> (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = (SELECT auth.uid()) AND p.application_status = 'approved'
    )
    AND (
      r.user_id IS NULL
      OR (m.created_at, m.id) > (r.last_read_at, COALESCE(r.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid))
    );
$$;
REVOKE ALL ON FUNCTION public.get_member_chat_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_chat_unread_count() TO authenticated;

CREATE TABLE IF NOT EXISTS public.member_chat_image_cleanup_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_chat_image_cleanup_queue_created_idx
  ON public.member_chat_image_cleanup_queue (created_at, id);
ALTER TABLE public.member_chat_image_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_chat_image_cleanup_queue FROM anon, authenticated, PUBLIC;
GRANT SELECT, DELETE ON public.member_chat_image_cleanup_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_member_chat_image_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.image_path IS NOT NULL AND btrim(OLD.image_path) <> '' THEN
    INSERT INTO public.member_chat_image_cleanup_queue (image_path)
    VALUES (OLD.image_path)
    ON CONFLICT (image_path) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_member_chat_image_cleanup ON public.member_chat_messages;
CREATE TRIGGER enqueue_member_chat_image_cleanup
AFTER DELETE ON public.member_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.enqueue_member_chat_image_cleanup();

-- The retention trigger must be able to prune old messages despite the five-minute
-- user-facing deletion restriction. This transaction-local flag is only set by the
-- SECURITY DEFINER retention function below.
CREATE OR REPLACE FUNCTION public.guard_member_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mention_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Chat messages must be sent as the authenticated user' USING ERRCODE = '42501';
    END IF;
    FOREACH mention_id IN ARRAY NEW.mentions LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = mention_id AND p.application_status = 'approved'
      ) THEN
        RAISE EXCEPTION 'Only approved members can be mentioned' USING ERRCODE = '42501';
      END IF;
    END LOOP;
    NEW.created_at := now();
    NEW.updated_at := NULL;
    NEW.deleted_at := NULL;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
      OR OLD.image_path IS DISTINCT FROM NEW.image_path OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
      OR OLD.mentions IS DISTINCT FROM NEW.mentions THEN
      RAISE EXCEPTION 'Only chat message text can be edited';
    END IF;
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF current_setting('pctc.chat_history_prune', true) IS DISTINCT FROM 'on'
      AND OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trim_member_chat_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('pctc.chat_history_prune', 'on', true);
  DELETE FROM public.member_chat_messages
  WHERE id IN (
    SELECT id FROM public.member_chat_messages
    ORDER BY created_at DESC, id DESC
    OFFSET 2000
  );
  PERFORM set_config('pctc.chat_history_prune', 'off', true);
  RETURN NULL;
END;
$$;

-- Read-marker changes also drive live unread badge updates.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_chat_reads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END;
$$;
-- Chat remains intentionally excluded from audit logging.
