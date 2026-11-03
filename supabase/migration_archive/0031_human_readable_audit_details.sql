-- BEGIN MIGRATION: 0031_human_readable_audit_details.sql
-- Human-readable diffs for registrations and court assignment saves.
CREATE OR REPLACE FUNCTION public.audit_statement_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count bigint := 0;
  v_row jsonb := '{}'::jsonb;
  v_id text;
  v_event_text text;
  v_event_id uuid;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_summary text;
  v_changes jsonb := '{}'::jsonb;
  v_people jsonb := '[]'::jsonb;
  v_old_row jsonb := '{}'::jsonb;
  v_field_diff jsonb := '{}'::jsonb;
  v_key text;
BEGIN
  IF current_setting('app.audit_suppressed', true) = 'true' THEN RETURN NULL; END IF;

  IF TG_TABLE_NAME = 'registrations' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
        'change', 'added', 'player_id', n.user_id, 'player_name', coalesce(p.full_name, p.email, n.user_id::text),
        'registration_id', n.id, 'event_id', n.event_id, 'new_status', n.status, 'new_queue_position', n.queue_position
      )), '[]'::jsonb), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_people, v_row FROM new_rows n LEFT JOIN public.profiles p ON p.id=n.user_id;
      v_event_text := v_row->>'event_id';
      v_changes := jsonb_build_object('affected_players', v_people, 'affected_count', v_count, 'operation', 'added');
      v_summary := CASE WHEN v_count=1 THEN 'Registration added: ' || coalesce(v_people->0->>'player_name','player') ELSE 'Registrations added: ' || v_count || ' players' END;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
        'change', 'removed', 'player_id', o.user_id, 'player_name', coalesce(p.full_name, p.email, o.user_id::text),
        'registration_id', o.id, 'event_id', o.event_id, 'old_status', o.status, 'old_queue_position', o.queue_position
      )), '[]'::jsonb), (array_agg(to_jsonb(o)))[1]
      INTO v_count, v_people, v_row FROM old_rows o LEFT JOIN public.profiles p ON p.id=o.user_id;
      v_event_text := v_row->>'event_id';
      v_changes := jsonb_build_object('affected_players', v_people, 'affected_count', v_count, 'operation', 'removed');
      v_summary := CASE WHEN v_count=1 THEN 'Registration removed: ' || coalesce(v_people->0->>'player_name','player') ELSE 'Registrations removed: ' || v_count || ' players' END;
    ELSE
      SELECT count(*) FILTER (WHERE (to_jsonb(n)-'updated_at') IS DISTINCT FROM (to_jsonb(o)-'updated_at')),
        coalesce(jsonb_agg(jsonb_build_object(
          'change', CASE WHEN o.user_id IS DISTINCT FROM n.user_id THEN 'replaced' ELSE 'updated' END,
          'player_id', n.user_id, 'player_name', coalesce(pn.full_name,pn.email,n.user_id::text),
          'previous_player_id', o.user_id, 'previous_player_name', coalesce(po.full_name,po.email,o.user_id::text),
          'registration_id', n.id, 'event_id', n.event_id,
          'old_status', o.status, 'new_status', n.status,
          'old_queue_position', o.queue_position, 'new_queue_position', n.queue_position,
          'old_payment_status', o.payment_status, 'new_payment_status', n.payment_status
        )) FILTER (WHERE (to_jsonb(n)-'updated_at') IS DISTINCT FROM (to_jsonb(o)-'updated_at')), '[]'::jsonb), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_people, v_row FROM new_rows n JOIN old_rows o ON o.id=n.id
      LEFT JOIN public.profiles pn ON pn.id=n.user_id LEFT JOIN public.profiles po ON po.id=o.user_id;
      IF v_count=0 THEN RETURN NULL; END IF;
      v_event_text := v_row->>'event_id';
      v_changes := jsonb_build_object('affected_players', v_people, 'affected_count', v_count, 'operation', 'updated');
      v_summary := CASE WHEN v_count=1 THEN 'Registration updated: ' || coalesce(v_people->0->>'player_name','player') ELSE 'Registrations updated: ' || v_count || ' players' END;
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN SELECT count(*), (array_agg(to_jsonb(n)))[1] INTO v_count,v_row FROM new_rows n;
    ELSIF TG_OP = 'UPDATE' THEN
      SELECT count(*), (array_agg(to_jsonb(n)))[1], (array_agg(to_jsonb(o)))[1] INTO v_count,v_row,v_old_row
      FROM new_rows n JOIN old_rows o ON coalesce(to_jsonb(n)->>'id',to_jsonb(n)->>'user_id',to_jsonb(n)->>'registration_id')=coalesce(to_jsonb(o)->>'id',to_jsonb(o)->>'user_id',to_jsonb(o)->>'registration_id')
      WHERE (to_jsonb(n)-'updated_at'-'last_sign_in_at'-'email'-'phone'-'avatar_url') IS DISTINCT FROM (to_jsonb(o)-'updated_at'-'last_sign_in_at'-'email'-'phone'-'avatar_url');
      IF v_count=0 THEN RETURN NULL; END IF;
      FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
        IF v_old_row->v_key IS DISTINCT FROM v_row->v_key AND v_key NOT IN ('updated_at','last_sign_in_at','email','phone','avatar_url','password','token','secret','body','content','description','notes','metadata') THEN
          v_field_diff := v_field_diff || jsonb_build_object(v_key,jsonb_build_object('old',v_old_row->v_key,'new',v_row->v_key));
        END IF;
      END LOOP;
    ELSE SELECT count(*), (array_agg(to_jsonb(o)))[1] INTO v_count,v_row FROM old_rows o;
    END IF;
    v_event_text := coalesce(v_row->>'event_id', CASE WHEN TG_TABLE_NAME='events' THEN v_row->>'id' END);
    v_changes := CASE WHEN TG_OP='UPDATE'
      THEN jsonb_build_object('affected_count',v_count,'operation','updated','record_id',coalesce(v_row->>'id',v_row->>'user_id',v_row->>'registration_id'),'field_changes',v_field_diff)
      ELSE jsonb_build_object('affected_count',v_count,'operation',lower(TG_OP),'record_id',coalesce(v_row->>'id',v_row->>'user_id',v_row->>'registration_id'),'changed_fields',to_jsonb(ARRAY(SELECT key FROM jsonb_object_keys(v_row) AS fields(key) WHERE key <> ALL(ARRAY['email','phone','application_comment','address','notes','description','content','body','metadata','password','token','secret','avatar_url']::text[])))) END;
    v_summary := CASE WHEN TG_TABLE_NAME='event_scores' THEN 'Match score ' || lower(TG_OP)
      ELSE replace(TG_TABLE_NAME,'_',' ') || ' ' || lower(TG_OP) END;
  END IF;

  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;
  v_id := CASE WHEN v_count=1 THEN coalesce(v_row->>'id',v_row->>'user_id',v_row->>'registration_id') ELSE NULL END;
  INSERT INTO public.audit_logs(actor_user_id,actor_label,action,outcome,target_table,target_record_id,event_id,source,summary,changes)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END, v_action, 'success', TG_TABLE_NAME, v_id, v_event_id, 'database', v_summary, v_changes);
  RETURN NULL;
END;
$$;

-- Court assignment save: capture actual player movement before replacing rows.
CREATE OR REPLACE FUNCTION public.save_event_court_assignments(p_event_id uuid, p_assignments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
  v_changes jsonb := '[]'::jsonb;
  v_summary text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN RAISE EXCEPTION 'Assignments must be a JSON array'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer);
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) WHERE court_number NOT BETWEEN 1 AND 4 OR segment_order NOT BETWEEN 1 AND 4) THEN RAISE EXCEPTION 'Invalid court or session'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) GROUP BY registration_id,segment_order HAVING count(*)>1) THEN RAISE EXCEPTION 'Player cannot be assigned to multiple courts in one session'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) LEFT JOIN public.registrations r ON r.id=a.registration_id AND r.event_id=p_event_id WHERE r.id IS NULL) THEN RAISE EXCEPTION 'Invalid registration for event'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'player_id', coalesce(n.user_id,o.user_id),
    'player_name', coalesce(p.full_name,p.email,coalesce(n.user_id,o.user_id)::text),
    'registration_id', coalesce(n.registration_id,o.registration_id),
    'session', coalesce(n.segment_order,o.segment_order),
    'previous_court', o.court_number,
    'new_court', n.court_number,
    'change', CASE WHEN o.court_number IS NULL THEN 'assigned' WHEN n.court_number IS NULL THEN 'unassigned' ELSE 'moved' END
  ) ORDER BY coalesce(n.segment_order,o.segment_order),coalesce(n.court_number,o.court_number)), '[]'::jsonb)
  INTO v_changes
  FROM (
    SELECT a.registration_id,a.court_number,a.segment_order,r.user_id FROM public.event_court_assignments a JOIN public.registrations r ON r.id=a.registration_id WHERE a.event_id=p_event_id
  ) o
  FULL JOIN (
    SELECT a.registration_id,a.court_number,a.segment_order,r.user_id FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer) JOIN public.registrations r ON r.id=a.registration_id
  ) n ON n.registration_id=o.registration_id AND n.segment_order=o.segment_order
  LEFT JOIN public.profiles p ON p.id=coalesce(n.user_id,o.user_id)
  WHERE o.court_number IS DISTINCT FROM n.court_number;

  PERFORM set_config('app.audit_suppressed','true',true);
  DELETE FROM public.event_court_assignments WHERE event_id=p_event_id;
  INSERT INTO public.event_court_assignments(event_id,registration_id,court_number,segment_order)
  SELECT p_event_id,a.registration_id,a.court_number,a.segment_order FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid,court_number integer,segment_order integer);
  PERFORM set_config('app.audit_suppressed','false',true);

  v_summary := CASE WHEN jsonb_array_length(v_changes)=0 THEN 'Court assignments saved (no player movement)'
    ELSE 'Court assignments updated: ' || jsonb_array_length(v_changes) || ' player-session changes' END;
  INSERT INTO public.audit_logs(actor_user_id,actor_label,action,outcome,target_table,event_id,source,summary,changes)
  VALUES(auth.uid(),'user','event_court_assignments.save','success','event_court_assignments',p_event_id,'database',v_summary,
    jsonb_build_object('player_changes',v_changes,'change_count',jsonb_array_length(v_changes),'assignments_after',v_count));
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_court_assignments(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_event_court_assignments(uuid,jsonb) TO authenticated;

-- END MIGRATION: 0031_human_readable_audit_details.sql
