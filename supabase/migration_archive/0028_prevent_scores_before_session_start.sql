-- BEGIN MIGRATION: 0028_prevent_scores_before_session_start.sql
-- Prevent score entry before the event session starts, including writes made outside the UI.
CREATE OR REPLACE FUNCTION public.block_scores_after_two_days()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_start timestamptz;
  v_type text;
BEGIN
  SELECT starts_at, event_type
    INTO v_start, v_type
  FROM public.events
  WHERE id = NEW.event_id;

  IF v_type = 'tournament' THEN
    RAISE EXCEPTION 'Scores are not available for tournament events.';
  END IF;

  IF TG_OP = 'INSERT' AND v_start > now() THEN
    RAISE EXCEPTION 'Scores cannot be entered before the session start time.';
  END IF;

  IF v_start < now() - interval '2 days' THEN
    RAISE EXCEPTION 'Scores can only be entered within two days of the event.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_old_event_scores ON public.event_scores;
CREATE TRIGGER block_old_event_scores
BEFORE INSERT OR UPDATE ON public.event_scores
FOR EACH ROW EXECUTE FUNCTION public.block_scores_after_two_days();
-- END MIGRATION: 0028_prevent_scores_before_session_start.sql
