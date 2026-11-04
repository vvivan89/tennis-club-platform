-- Team tournaments use the overall tournament capacity only; per-category caps
-- remain available for doubles tournament categories.
CREATE OR REPLACE FUNCTION public.guard_tournament_participant_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_config jsonb;
  v_total_limit integer;
  v_category_limit integer;
  v_total_count integer;
  v_category_count integer;
BEGIN
  IF public.is_event_manager() THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text)::bigint);
  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  IF NOT FOUND OR v_event.event_type <> 'tournament' OR v_event.status <> 'published'
     OR now() < v_event.registration_opens_at
     OR (v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at)
     OR now() >= v_event.starts_at THEN
    RAISE EXCEPTION 'Tournament registration is closed';
  END IF;
  IF auth.uid() IS NULL THEN
    IF NOT v_event.allow_non_member_registration OR NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Non-member registration is not enabled';
    END IF;
  ELSE
    IF NEW.user_id = auth.uid() THEN
      IF v_event.members_only AND NOT public.current_user_has_active_paid_membership() THEN
        RAISE EXCEPTION 'An active paid membership is required for this tournament';
      END IF;
    ELSIF NEW.user_id IS NULL AND NOT v_event.allow_non_member_registration THEN
      RAISE EXCEPTION 'Non-member registration is not enabled';
    END IF;
  END IF;

  IF NEW.status IN ('registered', 'provisional') THEN
    v_config := coalesce(v_event.tournament_config, '{}'::jsonb);
    v_total_limit := nullif(v_config->>'total_capacity', '')::integer;
    IF v_total_limit IS NULL THEN
      IF v_config ? 'total_capacity' THEN
        v_total_limit := NULL;
      ELSE
        v_total_limit := v_event.capacity;
      END IF;
    END IF;
    SELECT count(*) INTO v_total_count
      FROM public.tournament_participants
      WHERE event_id = NEW.event_id AND status IN ('registered', 'provisional');
    IF v_total_limit IS NOT NULL AND v_total_count >= v_total_limit THEN
      RAISE EXCEPTION 'Tournament total capacity has been reached';
    END IF;

    IF v_event.tournament_format <> 'team' THEN
      v_category_limit := nullif(v_config->'category_capacities'->>NEW.category, '')::integer;
      IF v_category_limit IS NOT NULL THEN
        SELECT count(*) INTO v_category_count
          FROM public.tournament_participants
          WHERE event_id = NEW.event_id AND category = NEW.category
            AND status IN ('registered', 'provisional');
        IF v_category_count >= v_category_limit THEN
          RAISE EXCEPTION 'Capacity for this tournament category has been reached';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
