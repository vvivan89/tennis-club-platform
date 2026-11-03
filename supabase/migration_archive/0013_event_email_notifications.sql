-- BEGIN MIGRATION: 0013_event_email_notifications.sql
-- Durable queue for event email notifications. Delivery is handled server-side through Resend.
CREATE TABLE IF NOT EXISTS public.event_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('registration_created','registration_cancelled','event_cancelled','waitlist_confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS event_notification_queue_pending_idx ON public.event_notification_queue(created_at) WHERE sent_at IS NULL;
ALTER TABLE public.event_notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_notification_queue FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_registration_email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('confirmed','waitlisted') THEN
    INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
    VALUES(NEW.event_id,NEW.user_id,'registration_created');
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status = 'cancelled' AND NEW.status IN ('confirmed','waitlisted') THEN
      INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
      VALUES(NEW.event_id,NEW.user_id,'registration_created');
    ELSIF OLD.status IN ('confirmed','waitlisted') AND NEW.status = 'cancelled' THEN
      INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
      VALUES(NEW.event_id,NEW.user_id,'registration_cancelled');
    ELSIF OLD.status = 'waitlisted' AND NEW.status = 'confirmed' THEN
      INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
      VALUES(NEW.event_id,NEW.user_id,'waitlist_confirmed');
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS queue_registration_email_notification ON public.registrations;
CREATE TRIGGER queue_registration_email_notification
AFTER INSERT OR UPDATE OF status ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.queue_registration_email_notification();

CREATE OR REPLACE FUNCTION public.queue_event_cancelled_email_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status='cancelled' THEN
    INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
    SELECT NEW.id,r.user_id,'event_cancelled'
    FROM public.registrations r
    WHERE r.event_id=NEW.id AND r.status IN ('confirmed','waitlisted');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS queue_event_cancelled_email_notifications ON public.events;
CREATE TRIGGER queue_event_cancelled_email_notifications
AFTER UPDATE OF status ON public.events
FOR EACH ROW EXECUTE FUNCTION public.queue_event_cancelled_email_notifications();

REVOKE ALL ON FUNCTION public.queue_registration_email_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_event_cancelled_email_notifications() FROM PUBLIC, anon, authenticated;
-- END MIGRATION: 0013_event_email_notifications.sql
