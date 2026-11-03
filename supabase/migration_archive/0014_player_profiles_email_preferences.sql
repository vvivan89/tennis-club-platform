-- BEGIN MIGRATION: 0014_player_profiles_email_preferences.sql
-- Player attributes, event gender restrictions, email preferences and court-assignment replacement support.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male','female'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS playing_hand text CHECK (playing_hand IN ('left','right'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_registration_updates boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_waitlist_updates boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_event_cancellations boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_registration_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_new_events boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_newsletter boolean NOT NULL DEFAULT true;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gender_restriction text CHECK (gender_restriction IN ('male','female'));

-- Court assignments can be transferred, along with score references, when replacing a roster member.
CREATE OR REPLACE FUNCTION public.replace_event_participant(p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_reg uuid; new_reg uuid;
BEGIN
 IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
 SELECT id INTO old_reg FROM public.registrations WHERE event_id=p_event_id AND user_id=p_old_user_id AND status IN ('confirmed','waitlisted') LIMIT 1 FOR UPDATE;
 SELECT id INTO new_reg FROM public.registrations WHERE event_id=p_event_id AND user_id=p_new_user_id AND status IN ('confirmed','waitlisted') LIMIT 1 FOR UPDATE;
 IF old_reg IS NULL OR new_reg IS NULL THEN RAISE EXCEPTION 'Both participants must be registered for this event.'; END IF;
 -- A score cannot list the same registration twice; preserve every transferable score and discard only impossible duplicate-player matches.
 DELETE FROM public.event_scores s WHERE s.event_id=p_event_id
 AND (s.player_one_registration_id=old_reg OR s.player_two_registration_id=old_reg OR s.player_three_registration_id=old_reg OR s.player_four_registration_id=old_reg)
 AND (s.player_one_registration_id=new_reg OR s.player_two_registration_id=new_reg OR s.player_three_registration_id=new_reg OR s.player_four_registration_id=new_reg);
 UPDATE public.event_court_assignments SET registration_id=new_reg WHERE event_id=p_event_id AND registration_id=old_reg
   AND NOT EXISTS (SELECT 1 FROM public.event_court_assignments x WHERE x.event_id=p_event_id AND x.registration_id=new_reg AND x.court_number=event_court_assignments.court_number AND x.segment_order=event_court_assignments.segment_order);
 UPDATE public.event_scores SET player_one_registration_id=new_reg WHERE event_id=p_event_id AND player_one_registration_id=old_reg;
 UPDATE public.event_scores SET player_two_registration_id=new_reg WHERE event_id=p_event_id AND player_two_registration_id=old_reg;
 UPDATE public.event_scores SET player_three_registration_id=new_reg WHERE event_id=p_event_id AND player_three_registration_id=old_reg;
 UPDATE public.event_scores SET player_four_registration_id=new_reg WHERE event_id=p_event_id AND player_four_registration_id=old_reg;
 DELETE FROM public.event_court_assignments WHERE event_id=p_event_id AND registration_id=old_reg;
 DELETE FROM public.event_scores WHERE event_id=p_event_id AND (player_one_registration_id=player_two_registration_id OR player_one_registration_id=player_three_registration_id OR player_one_registration_id=player_four_registration_id OR player_two_registration_id=player_three_registration_id OR player_two_registration_id=player_four_registration_id OR player_three_registration_id=player_four_registration_id);
 UPDATE public.registrations SET status='cancelled',queue_position=NULL,updated_at=now() WHERE id=old_reg;
END; $$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid,uuid,uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.event_email_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 email_type text NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,user_id,email_type)
);
ALTER TABLE public.event_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_email_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_event_gender_restriction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event_gender text; profile_gender text;
BEGIN
 SELECT gender_restriction INTO event_gender FROM public.events WHERE id=NEW.event_id;
 IF event_gender IS NOT NULL THEN
   SELECT gender INTO profile_gender FROM public.profiles WHERE id=NEW.user_id;
   IF profile_gender IS DISTINCT FROM event_gender THEN RAISE EXCEPTION 'This event is restricted to % participants. Update your profile gender to register if applicable.', event_gender; END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_event_gender_restriction ON public.registrations;
CREATE TRIGGER enforce_event_gender_restriction BEFORE INSERT OR UPDATE OF user_id,event_id ON public.registrations
 FOR EACH ROW WHEN (NEW.status IN ('confirmed','waitlisted')) EXECUTE FUNCTION public.enforce_event_gender_restriction();
REVOKE ALL ON FUNCTION public.enforce_event_gender_restriction() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.event_notification_queue DROP CONSTRAINT IF EXISTS event_notification_queue_notification_type_check;
ALTER TABLE public.event_notification_queue ADD CONSTRAINT event_notification_queue_notification_type_check CHECK (notification_type IN ('registration_created','registration_cancelled','event_cancelled','waitlist_confirmed','new_event_created'));
CREATE OR REPLACE FUNCTION public.queue_new_event_email_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  INSERT INTO public.event_notification_queue(event_id,user_id,notification_type)
  SELECT NEW.id,p.id,'new_event_created' FROM public.profiles p
  WHERE p.application_status='approved' AND p.email_new_events=true AND p.id IS DISTINCT FROM NEW.created_by;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS queue_new_event_email_notifications ON public.events;
CREATE TRIGGER queue_new_event_email_notifications AFTER INSERT OR UPDATE OF status ON public.events FOR EACH ROW EXECUTE FUNCTION public.queue_new_event_email_notifications();
REVOKE ALL ON FUNCTION public.queue_new_event_email_notifications() FROM PUBLIC, anon, authenticated;

-- Event types are hidden in the UI for now; new events retain the legacy column using a neutral default.
ALTER TABLE public.events ALTER COLUMN event_type SET DEFAULT 'social';
-- END MIGRATION: 0014_player_profiles_email_preferences.sql
