-- Queue one new-event email per recipient for a recurring series.
CREATE OR REPLACE FUNCTION public.queue_new_event_email_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Recurring sessions are separate event rows. Only the earliest session
    -- represents the series in the notification queue.
    IF NEW.series_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.events earlier
      WHERE earlier.series_id = NEW.series_id
        AND (earlier.starts_at, earlier.id) < (NEW.starts_at, NEW.id)
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.event_notification_queue(event_id, user_id, notification_type)
    SELECT NEW.id, p.id, 'new_event_created'
    FROM public.profiles p
    WHERE p.application_status = 'approved'
      AND p.email_new_events = true
      AND p.id IS DISTINCT FROM NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_new_event_email_notifications() FROM PUBLIC, anon, authenticated;
