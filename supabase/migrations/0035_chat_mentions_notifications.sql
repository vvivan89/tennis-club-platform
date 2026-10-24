-- BEGIN MIGRATION: 0035_chat_mentions_notifications.sql
-- Member-configurable in-app chat notifications and mention recipients.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS chat_notification_preference text NOT NULL DEFAULT 'all';
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_chat_notification_preference_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_chat_notification_preference_check
  CHECK (chat_notification_preference IN ('all', 'mentions', 'none'));

ALTER TABLE public.member_chat_messages
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.guard_member_chat_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
    IF OLD.created_at < now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within five minutes' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
-- Chat messages intentionally remain excluded from audit logging.
-- END MIGRATION: 0035_chat_mentions_notifications.sql
