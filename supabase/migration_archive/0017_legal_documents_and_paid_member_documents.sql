-- BEGIN MIGRATION: 0017_legal_documents_and_paid_member_documents.sql
-- Versioned legal documents managed by administrators.
CREATE TABLE IF NOT EXISTS public.legal_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('membership_waiver','terms_of_use','disclaimer')),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  body_html text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_document_one_current_version
  ON public.legal_document_versions(document_type) WHERE is_current = true;
ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read current legal documents" ON public.legal_document_versions;
CREATE POLICY "Public read current legal documents" ON public.legal_document_versions
  FOR SELECT TO anon, authenticated USING (is_current = true OR public.is_admin());
DROP POLICY IF EXISTS "Admins manage legal documents" ON public.legal_document_versions;
CREATE POLICY "Admins manage legal documents" ON public.legal_document_versions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON public.legal_document_versions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.legal_document_versions TO authenticated;

INSERT INTO public.legal_document_versions (document_type, version, title, body_html, is_current)
VALUES
 ('membership_waiver', 1, 'Membership Waiver', '<h2>Membership Waiver — Placeholder</h2><p>This is placeholder text only and is not a legally reviewed waiver. Replace it with wording reviewed by a qualified British Columbia lawyer before collecting signatures or relying on it.</p>', true),
 ('terms_of_use', 1, 'Site Terms of Use', '<h2>Terms of Use — Placeholder</h2><p>This is placeholder text for the PCTC website terms of use. It has not been reviewed by a lawyer and should be replaced before launch.</p>', true),
 ('disclaimer', 1, 'Disclaimer', '<h2>Disclaimer — Placeholder</h2><p>This is placeholder text for the PCTC website disclaimer. It has not been reviewed by a lawyer and should be replaced before launch.</p>', true)
ON CONFLICT (document_type, version) DO NOTHING;

-- Documents are available to approved members who have paid a membership fee at least once,
-- even if their membership has since expired. An approved but never-paid applicant is excluded.
CREATE OR REPLACE FUNCTION public.has_ever_paid_membership(v_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.memberships m ON m.user_id = pr.id
    WHERE pr.id = v_user
      AND pr.application_status = 'approved'
      AND (
        m.payment_status = 'paid'
        OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.membership_id = m.id AND p.status IN ('paid', 'recorded_manually')
        )
      )
  )
$$;
REVOKE ALL ON FUNCTION public.has_ever_paid_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ever_paid_membership(uuid) TO authenticated;

DROP POLICY IF EXISTS "Active members read documents" ON public.documents;
CREATE POLICY "Paid members read documents" ON public.documents FOR SELECT TO authenticated
  USING (public.has_ever_paid_membership() OR public.is_admin());
DROP POLICY IF EXISTS "Active members download PDFs" ON storage.objects;
CREATE POLICY "Paid members download PDFs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'member-documents' AND (public.has_ever_paid_membership() OR public.is_admin()));

-- Enable cross-session court-assignment updates where Supabase Realtime is available.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.event_court_assignments;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
-- END MIGRATION: 0017_legal_documents_and_paid_member_documents.sql
