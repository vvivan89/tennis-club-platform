-- BEGIN MIGRATION: 0020_waitlist_promotion_history.sql
-- Preserve successful waitlist promotions so attendance statistics can distinguish
-- people initially confirmed from people later promoted into an available place.
CREATE TABLE IF NOT EXISTS public.event_waitlist_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  promoted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_waitlist_promotions_event_idx ON public.event_waitlist_promotions(event_id);
ALTER TABLE public.event_waitlist_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event managers can view waitlist promotion history" ON public.event_waitlist_promotions;
CREATE POLICY "Event managers can view waitlist promotion history" ON public.event_waitlist_promotions
  FOR SELECT TO authenticated USING (public.is_event_manager());
REVOKE INSERT, UPDATE, DELETE ON public.event_waitlist_promotions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_event_waitlist_promotion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'waitlisted' AND NEW.status = 'confirmed' THEN
    INSERT INTO public.event_waitlist_promotions(registration_id,event_id,user_id,promoted_at)
    VALUES(NEW.id,NEW.event_id,NEW.user_id,coalesce(NEW.updated_at,now()));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS track_event_waitlist_promotion ON public.registrations;
CREATE TRIGGER track_event_waitlist_promotion
AFTER UPDATE OF status ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.track_event_waitlist_promotion();
-- END MIGRATION: 0020_waitlist_promotion_history.sql
