-- Skip child-delete audit inserts when the parent tournament event is being deleted.
CREATE OR REPLACE FUNCTION public.audit_tournament_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event_id uuid; v_actor uuid := auth.uid(); v_before jsonb; v_after jsonb; v_id uuid;
BEGIN
 v_event_id := CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
 v_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP='DELETE' AND NOT EXISTS (
   SELECT 1 FROM public.events WHERE id=v_event_id
 ) THEN
   RETURN OLD;
 END IF;
 IF TG_OP<>'INSERT' THEN v_before := to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN v_after := to_jsonb(NEW); END IF;
 INSERT INTO public.tournament_audit_log(event_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(v_event_id,v_actor,lower(TG_OP),TG_TABLE_NAME,v_id,v_before,v_after);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
