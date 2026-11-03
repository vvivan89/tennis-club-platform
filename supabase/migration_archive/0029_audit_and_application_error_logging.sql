-- BEGIN MIGRATION: 0029_audit_and_application_error_logging.sql
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text NOT NULL DEFAULT 'system',
  action text NOT NULL,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','failure','denied','info')),
  target_table text,
  target_record_id text,
  event_id uuid,
  route text,
  source text NOT NULL DEFAULT 'database',
  summary text NOT NULL DEFAULT '',
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text
);
CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON public.audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_event_idx ON public.audit_logs (event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON public.audit_logs (target_table, target_record_id);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

CREATE TABLE IF NOT EXISTS public.application_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('warning','error','critical')),
  source text NOT NULL DEFAULT 'server',
  error_type text NOT NULL DEFAULT 'ApplicationError',
  message text NOT NULL,
  route text,
  operation text,
  event_id uuid,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS application_errors_occurred_at_idx ON public.application_errors (occurred_at DESC);
CREATE INDEX IF NOT EXISTS application_errors_severity_idx ON public.application_errors (severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS application_errors_route_idx ON public.application_errors (route);
ALTER TABLE public.application_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read application errors" ON public.application_errors;
CREATE POLICY "Admins read application errors" ON public.application_errors FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.application_errors FROM anon, authenticated;
GRANT SELECT ON public.application_errors TO authenticated;

-- The RPC validates actor identity using the authenticated session. Callers cannot
-- impersonate another user or write arbitrary audit records.
CREATE OR REPLACE FUNCTION public.record_client_audit_event(
  p_action text, p_summary text DEFAULT '', p_route text DEFAULT NULL,
  p_source text DEFAULT 'web', p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_action NOT IN ('auth.sign_in','auth.sign_out','auth.sign_up','auth.password_recovery_requested') THEN
    RAISE EXCEPTION 'Unsupported client audit action';
  END IF;
  INSERT INTO public.audit_logs(actor_user_id, actor_label, action, outcome, route, source, summary, metadata)
  VALUES (v_actor, 'user', p_action, 'success', left(p_route, 500), left(p_source, 80), left(p_summary, 500), coalesce(p_metadata, '{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.record_client_audit_event(text,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_client_audit_event(text,text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_application_error(
  p_severity text, p_source text, p_error_type text, p_message text,
  p_route text DEFAULT NULL, p_operation text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_correlation_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_severity NOT IN ('warning','error','critical') THEN RAISE EXCEPTION 'Invalid severity'; END IF;
  INSERT INTO public.application_errors(actor_user_id,severity,source,error_type,message,route,operation,event_id,correlation_id,details)
  VALUES (auth.uid(), p_severity, left(coalesce(p_source,'web'),80), left(coalesce(p_error_type,'ApplicationError'),200), left(coalesce(p_message,'Unknown error'),2000), left(p_route,500), left(p_operation,200), p_event_id, left(p_correlation_id,200), coalesce(p_details,'{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.record_application_error(text,text,text,text,text,text,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_application_error(text,text,text,text,text,text,uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old jsonb; v_new jsonb; v_row jsonb; v_id text; v_event_text text; v_event_id uuid; v_action text; v_changes jsonb := '{}'::jsonb; v_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  v_row := coalesce(v_new, v_old);
  v_id := coalesce(v_row->>'id', v_row->>'user_id', v_row->>'registration_id');
  v_event_text := coalesce(v_row->>'event_id', CASE WHEN TG_TABLE_NAME='events' THEN v_row->>'id' END);
  BEGIN v_event_id := v_event_text::uuid; EXCEPTION WHEN others THEN v_event_id := NULL; END;
  v_action := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  IF TG_TABLE_NAME IN ('event_notification_queue','event_email_log') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_old->v_key IS DISTINCT FROM v_new->v_key AND v_key NOT IN ('updated_at','last_sign_in_at','email','phone','avatar_url','application_comment','password','token','secret','body','content','description','notes','metadata') THEN
        v_changes := v_changes || jsonb_build_object(v_key,jsonb_build_object('old',v_old->v_key,'new',v_new->v_key));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN RETURN NEW; END IF;
  ELSE
    v_changes := jsonb_build_object('record', (coalesce(v_new,v_old) - 'email' - 'phone' - 'application_comment' - 'address' - 'notes' - 'description' - 'content' - 'body' - 'metadata' - 'password' - 'token' - 'secret' - 'avatar_url'));
  END IF;
  INSERT INTO public.audit_logs(actor_user_id,actor_label,action,outcome,target_table,target_record_id,event_id,source,summary,changes)
  VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END, v_action, 'success', TG_TABLE_NAME, v_id, v_event_id, 'database', CASE
    WHEN TG_TABLE_NAME='registrations' AND TG_OP='UPDATE' AND v_new->>'status'='withdrawn' THEN 'Member withdrew from an event'
    WHEN TG_TABLE_NAME='registrations' AND TG_OP='INSERT' THEN 'Member registered for an event'
    WHEN TG_TABLE_NAME='event_court_assignments' THEN 'Court assignment ' || lower(TG_OP)
    WHEN TG_TABLE_NAME='event_scores' THEN 'Match score ' || lower(TG_OP)
    ELSE replace(TG_TABLE_NAME, '_', ' ') || ' ' || lower(TG_OP) END, v_changes);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','memberships','events','registrations','payments','event_court_assignments','event_scores','event_series','member_suspensions','member_admin_notes','club_settings','membership_plan_settings','news','gallery_albums','gallery_photos','legal_document_versions','documents','waiver_versions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);
    END IF;
  END LOOP;
END $$;
-- END MIGRATION: 0029_audit_and_application_error_logging.sql
