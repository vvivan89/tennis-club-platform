-- Let event managers confirm over-capacity League court assignments in the UI.
ALTER TABLE public.league_event_court_assignments
  DROP CONSTRAINT IF EXISTS league_event_court_assignments_segment_order_check;
ALTER TABLE public.league_event_court_assignments
  ADD CONSTRAINT league_event_court_assignments_segment_order_check CHECK (segment_order>=1);

CREATE OR REPLACE FUNCTION public.save_league_event_court_assignments(p_event_id uuid,p_assignments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_expected integer; v_count integer; v_invalid boolean;
BEGIN
  IF NOT public.is_event_manager() OR NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.social_doubles_ladders l ON l.id=e.social_doubles_ladder_id
    WHERE e.id=p_event_id AND e.event_type='tournament' AND e.tournament_format='doubles'
      AND l.competition_type='league' AND (public.is_admin() OR e.organizer_id=auth.uid() OR e.created_by=auth.uid())
  ) THEN RAISE EXCEPTION 'League event manager access required'; END IF;
  IF jsonb_typeof(p_assignments)<>'array' THEN RAISE EXCEPTION 'Court assignments must be an array'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_assignments);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    WHERE (item->>'court_number')::integer NOT BETWEEN 1 AND 4
      OR (item->>'segment_order')::integer<1
      OR NOT EXISTS (SELECT 1 FROM public.tournament_pairs pair
        WHERE pair.id=(item->>'pair_id')::uuid AND pair.event_id=p_event_id AND pair.status='active'
          AND pair.league_team_id IS NOT NULL)
  ) INTO v_invalid;
  IF v_invalid THEN RAISE EXCEPTION 'Assignments must use active League teams and valid courts'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'pair_id'),(item->>'segment_order') HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'A League team can only be assigned once per slot'; END IF;
  SELECT count(*) INTO v_expected FROM public.tournament_pairs pair
  WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL;
  IF v_expected>0 AND (v_count=0 OR v_count % v_expected<>0) THEN
    RAISE EXCEPTION 'Assign every active League team once in each slot';
  END IF;
  IF v_expected>0 AND EXISTS (
    SELECT 1 FROM generate_series(1,greatest(1,(SELECT max((item->>'segment_order')::integer)
      FROM jsonb_array_elements(p_assignments) item))) slots(slot)
    CROSS JOIN public.tournament_pairs pair
    WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) item
        WHERE (item->>'pair_id')::uuid=pair.id AND (item->>'segment_order')::integer=slots.slot)
  ) THEN RAISE EXCEPTION 'Assign every active League team once in each slot'; END IF;

  DELETE FROM public.league_event_court_assignments WHERE event_id=p_event_id;
  INSERT INTO public.league_event_court_assignments(event_id,pair_id,court_number,segment_order)
  SELECT p_event_id,(item->>'pair_id')::uuid,(item->>'court_number')::integer,(item->>'segment_order')::integer
  FROM jsonb_array_elements(p_assignments) item;
END; $$;
