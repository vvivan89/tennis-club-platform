-- BEGIN MIGRATION: 0030_audit_statement_level.sql
-- Audit one database statement as one entry instead of emitting one entry per row.
-- This prevents bulk operations (for example, assigning many court slots) from
-- flooding the audit log with dozens of indistinguishable records.
CREATE OR REPLACE FUNCTION public.audit_statement_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count bigint := 0;
  v_row jsonb := '{}'::jsonb;
  v_id text;
  v_event_text text;
  v_event_id uuid;
  v_changes jsonb := '{}'::jsonb;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_summary text;
BEGIN
  IF current_setting('app.audit_suppressed', true) = 'true' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_row FROM new_rows n;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT count(*), (array_agg(to_jsonb(n)))[1]
      INTO v_count, v_row
      FROM new_rows n
      JOIN old_rows o ON coalesce(to_jsonb(n)->>'id', to_jsonb(n)->>'user_id', to_jsonb(n)->>'registration_id')
                     = coalesce(to_jsonb(o)->>'id', to_jsonb(o)->>'user_id', to_jsonb(o)->>'registration_id')
     WHERE (to_jsonb(n) - 'updated_at' - 'last_sign_in_at' - 'email' - 'phone' - 'avatar_url')
           IS DISTINCT FROM
           (to_jsonb(o) - 'updated_at' - 'last_sign_in_at' - 'email' - 'phone' - 'avatar_url');
    IF v_count = 0 THEN RETURN NULL; END IF;
  ELSE
    SELECT count(*), (array_agg(to_jsonb(o)))[1]
      INTO v_count, v_row FROM old_rows o;
  END IF;

  v_id := CASE WHEN v_count = 1 THEN coalesce(v_row->>'id', v_row->>'user_id', v_row->>'registration_id') ELSE NULL END;
  v_event_text := coalesce(v_row->>'event_id', CASE WHEN TG_TABLE_NAME = 'events' THEN v_row->>'id' END);
  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;

  v_changes := jsonb_build_object(
    'affected_records', v_count,
    'sample_record', v_row - 'email' - 'phone' - 'application_comment' - 'address' - 'notes' - 'description' - 'content' - 'body' - 'metadata' - 'password' - 'token' - 'secret' - 'avatar_url'
  );
  v_summary := CASE
    WHEN TG_TABLE_NAME = 'registrations' AND TG_OP = 'INSERT' THEN 'Event registration created'
    WHEN TG_TABLE_NAME = 'registrations' AND TG_OP = 'UPDATE' AND v_row->>'status' = 'withdrawn' THEN 'Event registration updated'
    WHEN TG_TABLE_NAME = 'event_court_assignments' THEN 'Court assignments ' || lower(TG_OP) || ' (' || v_count || ' record' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')'
    WHEN TG_TABLE_NAME = 'event_scores' THEN 'Match scores ' || lower(TG_OP) || ' (' || v_count || ' record' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')'
    ELSE replace(TG_TABLE_NAME, '_', ' ') || ' ' || lower(TG_OP) || ' (' || v_count || ' record' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')'
  END;

  INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, target_record_id, event_id, source, summary, changes)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
          v_action, 'success', TG_TABLE_NAME, v_id, v_event_id, 'database', v_summary, v_changes);
  RETURN NULL;
END;
$$;

-- Notification delivery is infrastructure, not a user action. Remove any
-- trigger left behind by an earlier/manual installation as well.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['event_notification_queue','event_email_log'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_insert ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_update ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_delete ON public.%I', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','memberships','events','registrations','payments','event_court_assignments','event_scores','event_series','member_suspensions','member_admin_notes','club_settings','membership_plan_settings','news','gallery_albums','gallery_photos','legal_document_versions','documents','waiver_versions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_insert ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_update ON public.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_statement_delete ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_statement_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
      EXECUTE format('CREATE TRIGGER audit_statement_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_statement_change()', t);
    END IF;
  END LOOP;
END $$;


-- Court assignments are replaced using DELETE + INSERT today. Wrap those writes
-- in one RPC transaction and emit one business-action log for the whole save.
CREATE OR REPLACE FUNCTION public.save_event_court_assignments(
  p_event_id uuid,
  p_assignments jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_event_manager() THEN
    RAISE EXCEPTION 'Not authorized to manage event court assignments' USING ERRCODE = '42501';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be a JSON array';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_assignments) AS a(registration_id uuid, court_number integer, segment_order integer)
    LEFT JOIN public.registrations r ON r.id = a.registration_id AND r.event_id = p_event_id AND r.status = 'confirmed'
    WHERE r.id IS NULL OR a.court_number NOT BETWEEN 1 AND 4 OR a.segment_order NOT BETWEEN 1 AND 4
  ) THEN
    RAISE EXCEPTION 'Invalid court assignment';
  END IF;
  SELECT count(*) INTO v_count FROM jsonb_to_recordset(p_assignments)
    AS a(registration_id uuid, court_number integer, segment_order integer);
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments)
      AS a(registration_id uuid, court_number integer, segment_order integer)
    GROUP BY registration_id, court_number, segment_order HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate court assignment';
  END IF;

  PERFORM set_config('app.audit_suppressed', 'true', true);
  DELETE FROM public.event_court_assignments WHERE event_id = p_event_id;
  INSERT INTO public.event_court_assignments(event_id, registration_id, court_number, segment_order)
  SELECT p_event_id, a.registration_id, a.court_number, a.segment_order
  FROM jsonb_to_recordset(p_assignments)
    AS a(registration_id uuid, court_number integer, segment_order integer);
  PERFORM set_config('app.audit_suppressed', 'false', true);

  INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, target_table, event_id, source, summary, changes)
  VALUES (auth.uid(), 'user', 'event_court_assignments.save', 'success', 'event_court_assignments', p_event_id,
          'database', 'Court assignments saved (' || v_count || ' assignment' || CASE WHEN v_count = 1 THEN '' ELSE 's' END || ')',
          jsonb_build_object('affected_records', v_count));
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_court_assignments(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_court_assignments(uuid,jsonb) TO authenticated;

-- END MIGRATION: 0030_audit_statement_level.sql
