-- BEGIN MIGRATION: 0032_log_logical_business_actions.sql
-- Give new audit records a stable schema and make multi-statement RPCs the
-- authoritative boundary for business actions.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS event_schema_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS actor_name_snapshot text;

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_idempotency_key_idx
  ON public.audit_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_business_audit_event(
  p_action text,
  p_summary text,
  p_target_table text,
  p_target_record_id text,
  p_event_id uuid,
  p_changes jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_route text DEFAULT NULL,
  p_source text DEFAULT 'rpc',
  p_idempotency_key text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id bigint;
  v_scoped_key text;
BEGIN
  v_scoped_key := CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE
    concat_ws(':', coalesce(auth.uid()::text, 'system'), p_action, p_target_table,
      coalesce(p_target_record_id, ''), coalesce(p_event_id::text, ''), p_idempotency_key) END;
  INSERT INTO public.audit_logs(
    actor_user_id, actor_label, action, outcome, target_table, target_record_id,
    event_id, route, source, summary, changes, metadata, correlation_id,
    event_schema_version, idempotency_key, actor_name_snapshot
  ) VALUES (
    auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
    p_action, 'success', p_target_table, p_target_record_id, p_event_id,
    left(p_route, 500), left(coalesce(p_source, 'rpc'), 80), left(p_summary, 500),
    coalesce(p_changes, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb),
    coalesce(v_scoped_key, gen_random_uuid()::text), 2, v_scoped_key,
    (SELECT coalesce(p.full_name, p.email) FROM public.profiles p WHERE p.id = auth.uid())
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.audit_logs WHERE idempotency_key = v_scoped_key;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_business_audit_event(text,text,text,text,uuid,jsonb,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;

-- Non-RPC writes are still captured once per statement, with actual row-level
-- diffs grouped into one event rather than a count and an arbitrary sample row.
CREATE OR REPLACE FUNCTION public.audit_statement_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_entities jsonb := '[]'::jsonb;
  v_event_id uuid;
  v_event_text text;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_summary text;
BEGIN
  IF current_setting('app.audit_suppressed', true) = 'true' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('event_notification_queue', 'event_email_log') THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'type', TG_TABLE_NAME, 'operation', 'created',
      'id', coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'version'),
      'name', coalesce(to_jsonb(n)->>'full_name', to_jsonb(n)->>'title', to_jsonb(n)->>'name',
        (SELECT p.full_name FROM public.profiles p WHERE p.id = nullif(to_jsonb(n)->>'user_id', '')::uuid)),
      'event_id', to_jsonb(n)->>'event_id', 'user_id', to_jsonb(n)->>'user_id',
      'event_name', (SELECT e.title FROM public.events e WHERE e.id = nullif(to_jsonb(n)->>'event_id', '')::uuid),
      'new_values', to_jsonb(n) - 'password' - 'token' - 'secret' - 'credentials' - 'provider_reference'
    )), '[]'::jsonb), coalesce((array_agg(to_jsonb(n)))[1]->>'event_id',
      CASE WHEN TG_TABLE_NAME = 'events' THEN (array_agg(to_jsonb(n)))[1]->>'id' END)
    INTO v_entities, v_event_text
    FROM new_rows n;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'type', TG_TABLE_NAME, 'operation', 'deleted',
      'id', coalesce(to_jsonb(o)->>'id', to_jsonb(o)->>'user_id', to_jsonb(o)->>'version'),
      'name', coalesce(to_jsonb(o)->>'full_name', to_jsonb(o)->>'title', to_jsonb(o)->>'name',
        (SELECT p.full_name FROM public.profiles p WHERE p.id = nullif(to_jsonb(o)->>'user_id', '')::uuid)),
      'event_id', to_jsonb(o)->>'event_id', 'user_id', to_jsonb(o)->>'user_id',
      'event_name', (SELECT e.title FROM public.events e WHERE e.id = nullif(to_jsonb(o)->>'event_id', '')::uuid),
      'old_values', to_jsonb(o) - 'password' - 'token' - 'secret' - 'credentials' - 'provider_reference'
    )), '[]'::jsonb), coalesce((array_agg(to_jsonb(o)))[1]->>'event_id',
      CASE WHEN TG_TABLE_NAME = 'events' THEN (array_agg(to_jsonb(o)))[1]->>'id' END)
    INTO v_entities, v_event_text
    FROM old_rows o;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'type', TG_TABLE_NAME,
      'id', coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'version'),
      'name', coalesce(to_jsonb(n)->>'full_name', to_jsonb(n)->>'title', to_jsonb(n)->>'name',
        (SELECT p.full_name FROM public.profiles p WHERE p.id = nullif(to_jsonb(n)->>'user_id', '')::uuid)),
      'event_id', to_jsonb(n)->>'event_id', 'user_id', to_jsonb(n)->>'user_id',
      'event_name', (SELECT e.title FROM public.events e WHERE e.id = nullif(to_jsonb(n)->>'event_id', '')::uuid),
      'operation', 'updated',
      'field_changes', (
        SELECT coalesce(jsonb_object_agg(fields.key, jsonb_build_object(
          'old_value', to_jsonb(o)->fields.key, 'new_value', to_jsonb(n)->fields.key
        )), '{}'::jsonb)
        FROM (
          SELECT key FROM jsonb_object_keys(to_jsonb(n)) AS new_fields(key)
          UNION
          SELECT key FROM jsonb_object_keys(to_jsonb(o)) AS old_fields(key)
        ) fields
        WHERE to_jsonb(o)->fields.key IS DISTINCT FROM to_jsonb(n)->fields.key
          AND fields.key NOT IN ('updated_at', 'last_sign_in_at', 'password', 'token', 'secret', 'credentials', 'provider_reference')
      )
    )), '[]'::jsonb), coalesce((array_agg(to_jsonb(n)))[1]->>'event_id',
      CASE WHEN TG_TABLE_NAME = 'events' THEN (array_agg(to_jsonb(n)))[1]->>'id' END)
    INTO v_entities, v_event_text
    FROM new_rows n
    JOIN old_rows o ON coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'version', to_jsonb(n)->>'slug')
                    = coalesce(to_jsonb(o)->>'id', to_jsonb(o)->>'user_id', to_jsonb(o)->>'version', to_jsonb(o)->>'slug')
    WHERE to_jsonb(n) - 'updated_at' - 'last_sign_in_at'
      IS DISTINCT FROM to_jsonb(o) - 'updated_at' - 'last_sign_in_at';
    IF jsonb_array_length(v_entities) = 0 THEN RETURN NULL; END IF;
  END IF;

  IF jsonb_array_length(v_entities) = 0 THEN RETURN NULL; END IF;
  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;
  v_summary := replace(TG_TABLE_NAME, '_', ' ') || ' ' || lower(TG_OP);
  PERFORM public.record_business_audit_event(
    v_action, v_summary, TG_TABLE_NAME, NULL, v_event_id,
    jsonb_build_object('entities', v_entities, 'operation', lower(TG_OP)),
    jsonb_build_object('database_operation', TG_OP, 'table', TG_TABLE_NAME),
    NULL, 'database', NULL
  );
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['club_contacts', 'membership_families', 'membership_family_members'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_insert ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_update ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_delete ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_statement_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
    END IF;
  END LOOP;
END;
$$;

-- Court assignment is keyed by a player's registration and session. The table's
-- surrogate row ID is deliberately not treated as the identity of a movement.
DROP FUNCTION IF EXISTS public.save_event_court_assignments(uuid, jsonb);
CREATE FUNCTION public.save_event_court_assignments(
  p_event_id uuid, p_assignments jsonb, p_idempotency_key text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_count integer;
  v_changes jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_event_manager() THEN
    RAISE EXCEPTION 'Event manager access required' USING ERRCODE = '42501';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be a JSON array';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    LEFT JOIN public.registrations r ON r.id = a.registration_id AND r.event_id = p_event_id
    WHERE r.id IS NULL OR a.court_number NOT BETWEEN 1 AND 4 OR a.segment_order NOT BETWEEN 1 AND 4
  ) THEN RAISE EXCEPTION 'Invalid registration, court, or session'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    GROUP BY registration_id, segment_order HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'A player cannot be assigned to multiple courts in one session'; END IF;

  SELECT count(*) INTO v_count
  FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer);

  WITH old_slots AS (
    SELECT a.registration_id, r.user_id, a.segment_order,
      array_agg(a.court_number ORDER BY a.court_number) AS courts
    FROM public.event_court_assignments a
    JOIN public.registrations r ON r.id = a.registration_id
    WHERE a.event_id = p_event_id
    GROUP BY a.registration_id, r.user_id, a.segment_order
  ), new_slots AS (
    SELECT a.registration_id, r.user_id, a.segment_order,
      array_agg(a.court_number ORDER BY a.court_number) AS courts
    FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    JOIN public.registrations r ON r.id = a.registration_id
    GROUP BY a.registration_id, r.user_id, a.segment_order
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'court_assignment',
    'change', CASE WHEN o.registration_id IS NULL THEN 'assigned' WHEN n.registration_id IS NULL THEN 'unassigned' ELSE 'moved' END,
    'player_id', coalesce(n.user_id, o.user_id),
    'player_name', coalesce(p.full_name, 'Player ' || coalesce(n.user_id, o.user_id)::text),
    'registration_id', coalesce(n.registration_id, o.registration_id),
    'session', coalesce(n.segment_order, o.segment_order),
    'previous_courts', coalesce(to_jsonb(o.courts), '[]'::jsonb),
    'new_courts', coalesce(to_jsonb(n.courts), '[]'::jsonb),
    'previous_court', CASE WHEN cardinality(o.courts) = 1 THEN o.courts[1] END,
    'new_court', CASE WHEN cardinality(n.courts) = 1 THEN n.courts[1] END
  ) ORDER BY coalesce(n.segment_order, o.segment_order), coalesce(p.full_name, '')),
  '[]'::jsonb) INTO v_changes
  FROM old_slots o FULL JOIN new_slots n
    ON n.registration_id = o.registration_id AND n.segment_order = o.segment_order
  LEFT JOIN public.profiles p ON p.id = coalesce(n.user_id, o.user_id)
  WHERE o.courts IS DISTINCT FROM n.courts;

  IF jsonb_array_length(v_changes) = 0 THEN RETURN; END IF;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  DELETE FROM public.event_court_assignments WHERE event_id = p_event_id;
  INSERT INTO public.event_court_assignments(event_id, registration_id, court_number, segment_order)
  SELECT p_event_id, a.registration_id, a.court_number, a.segment_order
  FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer);
  PERFORM set_config('app.audit_suppressed', 'false', true);

  PERFORM public.record_business_audit_event(
    'event_court_assignments.save',
    'Court assignments updated: ' || jsonb_array_length(v_changes) || ' player assignments changed',
    'event_court_assignments', p_event_id::text, p_event_id,
    jsonb_build_object('entities', v_changes, 'change_count', jsonb_array_length(v_changes)),
    jsonb_build_object('event_name', v_event.title, 'assignment_count_after', v_count),
    NULL, 'rpc', p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_court_assignments(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_court_assignments(uuid, jsonb, text) TO authenticated;

-- A registration or withdrawal owns one parent entry, including any waitlist
-- status and queue-position changes performed by the withdrawal trigger.
DROP FUNCTION IF EXISTS public.register_for_event(uuid);
CREATE FUNCTION public.register_for_event(p_event_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.application_status = 'approved') THEN
    RAISE EXCEPTION 'Your registration is pending administrator approval.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'published' THEN RAISE EXCEPTION 'Event is unavailable'; END IF;
  IF (v_event.starts_at AT TIME ZONE 'America/Vancouver') <= (now() AT TIME ZONE 'America/Vancouver') THEN
    RAISE EXCEPTION 'Registration is unavailable for events that have already started';
  END IF;
  IF now() < v_event.registration_opens_at THEN RAISE EXCEPTION 'Registration has not opened'; END IF;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id = v_user AND (v_event.starts_at AT TIME ZONE 'America/Vancouver')::date BETWEEN s.starts_on AND s.ends_on AND s.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Your account is suspended for the event date and cannot register.';
  END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(v_user) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id = p_event_id AND r.user_id = v_user AND r.status <> 'cancelled') THEN
    RAISE EXCEPTION 'You are already registered or waitlisted';
  END IF;
  SELECT count(*) INTO v_count FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'confirmed';
  IF v_count < v_event.capacity THEN v_status := 'confirmed'; v_queue := NULL;
  ELSE
    IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
    SELECT coalesce(max(r.queue_position), 0) + 1 INTO v_queue FROM public.registrations r WHERE r.event_id = p_event_id AND r.status = 'waitlisted';
    v_status := 'waitlisted';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  PERFORM set_config('app.audit_suppressed', 'true', true);
  INSERT INTO public.registrations(event_id, user_id, status, queue_position, amount_cents, payment_status)
  VALUES (p_event_id, v_user, v_status, v_queue, v_event.price_cents,
    CASE WHEN v_event.price_cents = 0 THEN 'not_required' ELSE 'pending' END)
  RETURNING id INTO v_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);
  PERFORM public.record_business_audit_event(
    'event.registration.created', 'Added ' || coalesce(v_profile.full_name, 'a player') || ' to ' || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'added', 'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', NULL, 'new_status', v_status, 'new_queue_position', v_queue
    )), 'operation', 'added'),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'player_id', v_user, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_user::text),
      'new_status', v_status, 'queue_position', v_queue),
    NULL, 'rpc', p_idempotency_key
  );
  RETURN QUERY SELECT v_id, v_status, v_queue;
END;
$$;
REVOKE ALL ON FUNCTION public.register_for_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.withdraw_from_event(uuid);
CREATE FUNCTION public.withdraw_from_event(p_registration_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_registration public.registrations%rowtype;
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_before jsonb;
  v_changes jsonb;
BEGIN
  SELECT * INTO v_registration FROM public.registrations WHERE id = p_registration_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_registration.event_id;
  IF v_event.registration_closes_at IS NOT NULL AND now() >= v_event.registration_closes_at THEN
    RAISE EXCEPTION 'The registration cutoff has passed; you can no longer withdraw.';
  END IF;
  IF v_registration.status = 'cancelled' THEN RETURN; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_registration.user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_before
  FROM public.registrations r WHERE r.event_id = v_registration.event_id;

  PERFORM set_config('app.audit_suppressed', 'true', true);
  UPDATE public.registrations SET status = 'cancelled', queue_position = NULL, updated_at = now() WHERE id = p_registration_id;
  PERFORM set_config('app.audit_suppressed', 'false', true);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'registration', 'change', CASE WHEN r.status = 'cancelled' THEN 'removed' ELSE 'updated' END,
    'player_id', r.user_id, 'player_name', coalesce(p.full_name, 'Player ' || r.user_id::text),
    'registration_id', r.id, 'event_id', r.event_id, 'event_name', v_event.title,
    'old_status', before_row.value->>'status', 'new_status', r.status,
    'old_queue_position', (before_row.value->>'queue_position')::bigint,
    'new_queue_position', r.queue_position
  ) ORDER BY r.created_at, r.id), '[]'::jsonb) INTO v_changes
  FROM jsonb_array_elements(v_before) AS before_row(value)
  JOIN public.registrations r ON r.id = (before_row.value->>'id')::uuid
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE (before_row.value->>'status') IS DISTINCT FROM r.status::text
     OR (before_row.value->>'queue_position') IS DISTINCT FROM r.queue_position::text;

  PERFORM public.record_business_audit_event(
    'event.registration.withdrawn', 'Removed ' || coalesce(v_profile.full_name, 'a player') || ' from ' || v_event.title,
    'registrations', p_registration_id::text, v_event.id,
    jsonb_build_object('entities', v_changes, 'operation', 'withdrawn'),
    jsonb_build_object('registration_id', p_registration_id, 'event_id', v_event.id, 'event_name', v_event.title,
      'player_id', v_registration.user_id, 'player_name', coalesce(v_profile.full_name, 'Player ' || v_registration.user_id::text)),
    NULL, 'rpc', p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_from_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_from_event(uuid, text) TO authenticated;

-- Administrator add/remove batches and their waitlist consequences are logged
-- once at the RPC boundary. Existing eligibility and capacity rules are retained.
DROP FUNCTION IF EXISTS public.manage_event_registration(uuid, uuid, text);
CREATE FUNCTION public.manage_event_registration(
  p_event_id uuid, p_user_id uuid, p_action text, p_idempotency_key text DEFAULT NULL
) RETURNS TABLE(registration_id uuid, registration_state public.registration_status, position_in_waitlist bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_existing public.registrations%rowtype;
  v_profile public.profiles%rowtype;
  v_count integer;
  v_status public.registration_status;
  v_queue bigint;
  v_id uuid;
  v_before jsonb;
  v_changes jsonb;
  v_operation text;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Event manager access required'; END IF;
  PERFORM set_config('app.event_manager_override_suspension', 'on', true);
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_before
  FROM public.registrations r WHERE r.event_id = p_event_id;

  IF p_action = 'remove' THEN
    SELECT * INTO v_existing FROM public.registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM set_config('app.audit_suppressed', 'true', true);
    UPDATE public.registrations SET status = 'cancelled', queue_position = NULL, updated_at = now() WHERE id = v_existing.id;
    PERFORM set_config('app.audit_suppressed', 'false', true);
    v_id := v_existing.id;
    v_status := 'cancelled';
    v_queue := NULL;
    v_operation := 'removed';
  ELSIF p_action = 'add' THEN
    IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event_id AND user_id = p_user_id AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'Member is already registered or waitlisted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.application_status = 'approved') THEN
      RAISE EXCEPTION 'Member must have an approved account';
    END IF;
    IF v_event.members_only AND NOT public.has_active_paid_membership(p_user_id) THEN RAISE EXCEPTION 'An active, paid membership is required'; END IF;
    SELECT count(*) INTO v_count FROM public.registrations WHERE event_id = p_event_id AND status = 'confirmed';
    IF v_count < v_event.capacity THEN v_status := 'confirmed'; v_queue := NULL;
    ELSE
      IF NOT v_event.waitlist_enabled THEN RAISE EXCEPTION 'Event is full and waitlist is disabled'; END IF;
      SELECT coalesce(max(queue_position), 0) + 1 INTO v_queue FROM public.registrations WHERE event_id = p_event_id AND status = 'waitlisted';
      v_status := 'waitlisted';
    END IF;
    PERFORM set_config('app.audit_suppressed', 'true', true);
    INSERT INTO public.registrations(event_id, user_id, status, queue_position, amount_cents, payment_status)
    VALUES (p_event_id, p_user_id, v_status, v_queue, v_event.price_cents,
      CASE WHEN v_event.price_cents = 0 THEN 'not_required' ELSE 'pending' END) RETURNING id INTO v_id;
    PERFORM set_config('app.audit_suppressed', 'false', true);
    v_operation := 'added';
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'registration', 'change', CASE WHEN r.status = 'cancelled' THEN 'removed' WHEN before_row.value IS NULL THEN 'added' ELSE 'updated' END,
    'player_id', r.user_id, 'player_name', coalesce(p.full_name, 'Player ' || r.user_id::text),
    'registration_id', r.id, 'event_id', r.event_id, 'event_name', v_event.title,
    'old_status', before_row.value->>'status', 'new_status', r.status,
    'old_queue_position', (before_row.value->>'queue_position')::bigint,
    'new_queue_position', r.queue_position
  ) ORDER BY r.created_at, r.id), '[]'::jsonb) INTO v_changes
  FROM public.registrations r
  LEFT JOIN LATERAL (
    SELECT item AS value FROM jsonb_array_elements(v_before) AS prior(item)
    WHERE item->>'id' = r.id::text LIMIT 1
  ) before_row ON true
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE (before_row.value IS NULL AND r.id = v_id)
     OR (before_row.value IS NOT NULL AND ((before_row.value->>'status') IS DISTINCT FROM r.status::text
       OR (before_row.value->>'queue_position') IS DISTINCT FROM r.queue_position::text));

  PERFORM public.record_business_audit_event(
    CASE WHEN v_operation = 'added' THEN 'event.registration.admin_added' ELSE 'event.registration.admin_removed' END,
    CASE WHEN v_operation = 'added' THEN 'Added ' ELSE 'Removed ' END || coalesce(v_profile.full_name, 'a player') || ' ' ||
      CASE WHEN v_operation = 'added' THEN 'to ' ELSE 'from ' END || v_event.title,
    'registrations', v_id::text, p_event_id,
    jsonb_build_object('entities', v_changes, 'operation', v_operation),
    jsonb_build_object('registration_id', v_id, 'event_id', p_event_id, 'event_name', v_event.title,
      'player_id', p_user_id, 'player_name', coalesce(v_profile.full_name, 'Player ' || p_user_id::text)),
    NULL, 'rpc', p_idempotency_key
  );
  IF v_operation = 'added' THEN RETURN QUERY SELECT v_id, v_status, v_queue; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_event_registration(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_event_registration(uuid, uuid, text, text) TO authenticated;

-- Participant replacement changes registrations, assignments, scores, and queue
-- positions but remains one administrator decision and one audit event.
DROP FUNCTION IF EXISTS public.replace_event_participant(uuid, uuid, uuid);
CREATE FUNCTION public.replace_event_participant(
  p_event_id uuid, p_old_user_id uuid, p_new_user_id uuid, p_idempotency_key text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.events%rowtype;
  v_old public.registrations%rowtype;
  v_new public.registrations%rowtype;
  v_old_profile public.profiles%rowtype;
  v_new_profile public.profiles%rowtype;
  v_assignment_count integer := 0;
  v_score_count integer := 0;
BEGIN
  IF NOT public.is_event_manager() THEN RAISE EXCEPTION 'Only event managers can replace participants.'; END IF;
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL OR p_old_user_id = p_new_user_id THEN RAISE EXCEPTION 'Choose two different members.'; END IF;
  PERFORM set_config('app.event_manager_override_suspension', 'on', true);
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found.'; END IF;
  SELECT * INTO v_old FROM public.registrations WHERE event_id = p_event_id AND user_id = p_old_user_id AND status IN ('confirmed', 'waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'The player being replaced is not registered for this event.'; END IF;
  SELECT * INTO v_new FROM public.registrations WHERE event_id = p_event_id AND user_id = p_new_user_id AND status IN ('confirmed', 'waitlisted') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_new.id IS NOT NULL AND v_new.status <> 'waitlisted' THEN RAISE EXCEPTION 'The selected member is already confirmed for this event.'; END IF;
  SELECT * INTO v_old_profile FROM public.profiles WHERE id = p_old_user_id;
  SELECT * INTO v_new_profile FROM public.profiles WHERE id = p_new_user_id;
  IF NOT FOUND OR v_new_profile.application_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'The replacement must be an approved member.'; END IF;
  IF v_event.members_only AND NOT public.has_active_paid_membership(p_new_user_id) THEN RAISE EXCEPTION 'The replacement must have an active, paid membership for this members-only event.'; END IF;

  PERFORM set_config('app.audit_suppressed', 'true', true);
  IF v_old.status = 'confirmed' AND v_new.status = 'waitlisted' THEN
    UPDATE public.event_court_assignments SET registration_id = v_new.id WHERE registration_id = v_old.id;
    GET DIAGNOSTICS v_assignment_count = ROW_COUNT;
    UPDATE public.event_scores SET player_one_registration_id = v_new.id WHERE player_one_registration_id = v_old.id;
    GET DIAGNOSTICS v_score_count = ROW_COUNT;
    UPDATE public.event_scores SET player_two_registration_id = v_new.id WHERE player_two_registration_id = v_old.id;
    UPDATE public.event_scores SET player_three_registration_id = v_new.id WHERE player_three_registration_id = v_old.id;
    UPDATE public.event_scores SET player_four_registration_id = v_new.id WHERE player_four_registration_id = v_old.id;
    UPDATE public.registrations SET status = 'cancelled', queue_position = NULL, updated_at = now() WHERE id = v_old.id;
    UPDATE public.registrations SET status = 'confirmed', queue_position = NULL, updated_at = now() WHERE id = v_new.id;
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY queue_position NULLS LAST, created_at, id) AS new_position
      FROM public.registrations WHERE event_id = p_event_id AND status = 'waitlisted'
    )
    UPDATE public.registrations r SET queue_position = ranked.new_position, updated_at = now()
    FROM ranked WHERE r.id = ranked.id;
  ELSIF v_new.id IS NULL THEN
    UPDATE public.registrations SET user_id = p_new_user_id, updated_at = now() WHERE id = v_old.id;
  ELSE
    RAISE EXCEPTION 'The selected member cannot replace this player.';
  END IF;
  PERFORM set_config('app.audit_suppressed', 'false', true);

  PERFORM public.record_business_audit_event(
    'event.registration.replaced', 'Replaced ' || coalesce(v_old_profile.full_name, 'a player') || ' with ' ||
      coalesce(v_new_profile.full_name, 'a player') || ' in ' || v_event.title,
    'registrations', coalesce(v_new.id, v_old.id)::text, p_event_id,
    jsonb_build_object('entities', jsonb_build_array(jsonb_build_object(
      'type', 'registration', 'change', 'replaced', 'player_id', p_new_user_id,
      'player_name', coalesce(v_new_profile.full_name, 'Player ' || p_new_user_id::text),
      'previous_player_id', p_old_user_id,
      'previous_player_name', coalesce(v_old_profile.full_name, 'Player ' || p_old_user_id::text),
      'registration_id', coalesce(v_new.id, v_old.id), 'previous_registration_id', v_old.id,
      'event_id', p_event_id, 'event_name', v_event.title,
      'old_status', v_old.status, 'new_status', CASE WHEN v_new.id IS NOT NULL THEN 'confirmed' ELSE v_old.status END
    )), 'operation', 'replaced'),
    jsonb_build_object('event_id', p_event_id, 'event_name', v_event.title,
      'previous_player_id', p_old_user_id, 'previous_player_name', v_old_profile.full_name,
      'replacement_player_id', p_new_user_id, 'replacement_player_name', v_new_profile.full_name,
      'previous_registration_id', v_old.id, 'replacement_registration_id', coalesce(v_new.id, v_old.id),
      'transferred_assignment_count', v_assignment_count, 'updated_score_rows', v_score_count),
    NULL, 'rpc', p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.replace_event_participant(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_event_participant(uuid, uuid, uuid, text) TO authenticated;
-- END MIGRATION: 0032_log_logical_business_actions.sql
