-- BEGIN MIGRATION: 0015_member_documents.sql
-- Member-only PDF library with admin uploads.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT 'application/pdf';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_size_bytes bigint;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.is_active_member(v_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.memberships m
   WHERE m.user_id = v_user AND m.status = 'active'
     AND (m.starts_on IS NULL OR m.starts_on <= current_date)
     AND (m.ends_on IS NULL OR m.ends_on >= current_date)
 )
$$;
REVOKE ALL ON FUNCTION public.is_active_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_member(uuid) TO authenticated;

DROP POLICY IF EXISTS "Members read permitted documents" ON public.documents;
DROP POLICY IF EXISTS "Active members read documents" ON public.documents;
CREATE POLICY "Active members read documents" ON public.documents FOR SELECT TO authenticated
 USING (public.is_active_member() OR public.is_admin());
DROP POLICY IF EXISTS "Admins manage documents" ON public.documents;
CREATE POLICY "Admins manage documents" ON public.documents FOR ALL TO authenticated
 USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON public.documents TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.documents TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('member-documents', 'member-documents', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520, allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS "Admins upload member PDFs" ON storage.objects;
CREATE POLICY "Admins upload member PDFs" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id = 'member-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Admins update member PDFs" ON storage.objects;
CREATE POLICY "Admins update member PDFs" ON storage.objects FOR UPDATE TO authenticated
 USING (bucket_id = 'member-documents' AND public.is_admin())
 WITH CHECK (bucket_id = 'member-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Admins delete member PDFs" ON storage.objects;
CREATE POLICY "Admins delete member PDFs" ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id = 'member-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Active members download PDFs" ON storage.objects;
CREATE POLICY "Active members download PDFs" ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id = 'member-documents' AND (public.is_active_member() OR public.is_admin()));
-- END MIGRATION: 0015_member_documents.sql
