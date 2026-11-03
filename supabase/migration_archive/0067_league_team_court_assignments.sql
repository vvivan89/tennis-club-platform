-- Store court assignments as fixed League pairs (two players per team).
BEGIN;

CREATE TABLE IF NOT EXISTS public.league_event_court_assignments (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  pair_id uuid NOT NULL REFERENCES public.tournament_pairs(id) ON DELETE CASCADE,
  court_number integer NOT NULL CHECK (court_number BETWEEN 1 AND 4),
  segment_order integer NOT NULL DEFAULT 1 CHECK (segment_order BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id,pair_id,segment_order),
  FOREIGN KEY (event_id,pair_id) REFERENCES public.tournament_pairs(event_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS league_event_court_assignments_slot_idx
  ON public.league_event_court_assignments(event_id,segment_order,court_number);
ALTER TABLE public.league_event_court_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "League court assignments are public" ON public.league_event_court_assignments;
CREATE POLICY "League court assignments are public" ON public.league_event_court_assignments
  FOR SELECT TO anon,authenticated USING (EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=league_event_court_assignments.event_id AND e.status='published'
  ));
DROP POLICY IF EXISTS "Event managers manage League court assignments" ON public.league_event_court_assignments;
CREATE POLICY "Event managers manage League court assignments" ON public.league_event_court_assignments
  FOR ALL TO authenticated USING (public.is_event_manager()) WITH CHECK (public.is_event_manager());
GRANT SELECT ON public.league_event_court_assignments TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.league_event_court_assignments TO authenticated;

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
      OR (item->>'segment_order')::integer NOT BETWEEN 1 AND 4
      OR NOT EXISTS (SELECT 1 FROM public.tournament_pairs pair
        WHERE pair.id=(item->>'pair_id')::uuid AND pair.event_id=p_event_id AND pair.status='active'
          AND pair.league_team_id IS NOT NULL)
  ) INTO v_invalid;
  IF v_invalid THEN RAISE EXCEPTION 'Assignments must use active League teams and valid courts'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'pair_id'),(item->>'segment_order') HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'A League team can only be assigned once per slot'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'segment_order'),(item->>'court_number') HAVING count(*)>2
  ) THEN RAISE EXCEPTION 'Each court can hold two League teams per slot'; END IF;
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

REVOKE ALL ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) TO authenticated;

COMMIT;
