-- Turn each court/sub-session containing exactly two assigned League teams
-- into a normal tournament match so the existing score and standings pipeline
-- can be used without a parallel score store.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS tournament_matches_league_assignment_slot_unique
  ON public.tournament_matches(event_id, match_number)
  WHERE notes = 'league-court-assignment';

CREATE OR REPLACE FUNCTION public.save_league_event_court_assignments(p_event_id uuid,p_assignments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_invalid boolean;
  v_expected integer;
  v_max_segment integer;
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
  SELECT coalesce(max((item->>'segment_order')::integer),1) INTO v_max_segment
  FROM jsonb_array_elements(p_assignments) item;
  IF v_expected>0 AND EXISTS (
    SELECT 1 FROM generate_series(1,v_max_segment) slots(slot)
    CROSS JOIN public.tournament_pairs pair
    WHERE pair.event_id=p_event_id AND pair.status='active' AND pair.league_team_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) item
        WHERE (item->>'pair_id')::uuid=pair.id AND (item->>'segment_order')::integer=slots.slot)
  ) THEN RAISE EXCEPTION 'Assign every active League team once in each sub-session'; END IF;

  -- Do not silently discard a result if an administrator changes a completed matchup.
  IF EXISTS (
    SELECT 1
    FROM public.tournament_matches m
    JOIN LATERAL (
      SELECT (array_agg((item->>'pair_id')::uuid ORDER BY (item->>'pair_id')::uuid))[1] AS pair_one_id,
             (array_agg((item->>'pair_id')::uuid ORDER BY (item->>'pair_id')::uuid))[2] AS pair_two_id
      FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'segment_order')::integer=(((m.match_number-1)/10)+1)
        AND (item->>'court_number')::integer=(((m.match_number-1)%10)+1)
    ) proposed ON true
    WHERE m.event_id=p_event_id AND m.notes='league-court-assignment' AND m.status='completed'
      AND (m.pair_one_id IS DISTINCT FROM proposed.pair_one_id OR m.pair_two_id IS DISTINCT FROM proposed.pair_two_id)
  ) THEN RAISE EXCEPTION 'A completed League match cannot be reassigned. Correct or remove its score first.'; END IF;

  DELETE FROM public.league_event_court_assignments WHERE event_id=p_event_id;
  INSERT INTO public.league_event_court_assignments(event_id,pair_id,court_number,segment_order)
  SELECT p_event_id,(item->>'pair_id')::uuid,(item->>'court_number')::integer,(item->>'segment_order')::integer
  FROM jsonb_array_elements(p_assignments) item;

  -- One normal tournament_matches row for every full court (two teams) in each slot.
  INSERT INTO public.tournament_matches(
    event_id,category,phase,group_number,round_number,match_number,
    pair_one_id,pair_two_id,scheduled_at,court_number,status,notes
  )
  SELECT p_event_id, pair_one.category, 'round_robin', NULL, slot.segment_order,
         (slot.segment_order-1)*10+slot.court_number,
         pair_one.id, pair_two.id,
         e.starts_at + ((coalesce(extract(epoch FROM (e.ends_at-e.starts_at)),3600) / greatest(v_max_segment,1))
           * (slot.segment_order-1)) * interval '1 second',
         slot.court_number, 'scheduled', 'league-court-assignment'
  FROM (
    SELECT (item->>'segment_order')::integer AS segment_order,
           (item->>'court_number')::integer AS court_number,
           array_agg((item->>'pair_id')::uuid ORDER BY (item->>'pair_id')::uuid) AS pair_ids
    FROM jsonb_array_elements(p_assignments) item
    GROUP BY (item->>'segment_order')::integer,(item->>'court_number')::integer
    HAVING count(*)=2
  ) slot
  JOIN public.tournament_pairs pair_one ON pair_one.id=slot.pair_ids[1]
  JOIN public.tournament_pairs pair_two ON pair_two.id=slot.pair_ids[2]
  JOIN public.events e ON e.id=p_event_id
  ON CONFLICT (event_id,match_number) WHERE notes='league-court-assignment'
  DO UPDATE SET
    category=EXCLUDED.category,
    pair_one_id=EXCLUDED.pair_one_id,
    pair_two_id=EXCLUDED.pair_two_id,
    scheduled_at=EXCLUDED.scheduled_at,
    court_number=EXCLUDED.court_number,
    round_number=EXCLUDED.round_number,
    updated_at=now()
  WHERE public.tournament_matches.status<>'completed';

  -- Remove obsolete, unplayed generated matches when assignments are removed or moved.
  DELETE FROM public.tournament_matches m
  WHERE m.event_id=p_event_id AND m.notes='league-court-assignment' AND m.status<>'completed'
    AND NOT EXISTS (
      SELECT 1 FROM public.league_event_court_assignments a1
      JOIN public.league_event_court_assignments a2
        ON a2.event_id=a1.event_id AND a2.segment_order=a1.segment_order
       AND a2.court_number=a1.court_number AND a2.pair_id<>a1.pair_id
      WHERE a1.event_id=m.event_id
        AND (a1.segment_order-1)*10+a1.court_number=m.match_number
    );
END; $$;

REVOKE ALL ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_league_event_court_assignments(uuid,jsonb) TO authenticated;

-- Backfill matches for assignments that were saved before this migration.
DO $$
DECLARE v_event record; v_max_segment integer;
BEGIN
  FOR v_event IN
    SELECT DISTINCT a.event_id FROM public.league_event_court_assignments a
  LOOP
    SELECT greatest(1,max(segment_order)) INTO v_max_segment
    FROM public.league_event_court_assignments WHERE event_id=v_event.event_id;
    INSERT INTO public.tournament_matches(
      event_id,category,phase,group_number,round_number,match_number,
      pair_one_id,pair_two_id,scheduled_at,court_number,status,notes
    )
    SELECT a.event_id,p1.category,'round_robin',NULL,a.segment_order,
           (a.segment_order-1)*10+a.court_number,p1.id,p2.id,
           e.starts_at + ((coalesce(extract(epoch FROM (e.ends_at-e.starts_at)),3600) / greatest(v_max_segment,1))
             * (a.segment_order-1)) * interval '1 second',
           a.court_number,'scheduled','league-court-assignment'
    FROM (
      SELECT event_id,segment_order,court_number,
             (array_agg(pair_id ORDER BY pair_id))[1] AS pair_one_id,
             (array_agg(pair_id ORDER BY pair_id))[2] AS pair_two_id
      FROM public.league_event_court_assignments
      WHERE event_id=v_event.event_id
      GROUP BY event_id,segment_order,court_number HAVING count(*)=2
    ) a
    JOIN public.tournament_pairs p1 ON p1.id=a.pair_one_id
    JOIN public.tournament_pairs p2 ON p2.id=a.pair_two_id
    JOIN public.events e ON e.id=a.event_id
    ON CONFLICT (event_id,match_number) WHERE notes='league-court-assignment' DO NOTHING;
  END LOOP;
END $$;

COMMIT;
