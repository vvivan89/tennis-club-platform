-- BEGIN MIGRATION: 0018_photo_gallery.sql
-- PCTC photo gallery: private storage with visibility enforced by RLS.
CREATE TABLE IF NOT EXISTS public.gallery_albums (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK (length(trim(title)) > 0),
 description text NOT NULL DEFAULT '',
 visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','members')),
 is_published boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.gallery_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES public.gallery_albums(id) ON DELETE CASCADE,
 storage_path text NOT NULL UNIQUE,
 caption text NOT NULL DEFAULT '',
 alt_text text NOT NULL DEFAULT '',
 sort_order integer NOT NULL DEFAULT 0,
 uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gallery_albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Gallery albums readable by permitted viewers" ON public.gallery_albums;
CREATE POLICY "Gallery albums readable by permitted viewers" ON public.gallery_albums FOR SELECT TO anon, authenticated USING (
 is_published AND (visibility = 'public' OR (auth.uid() IS NOT NULL AND (public.is_admin() OR (public.has_ever_paid_membership() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved')))))
 OR public.is_admin()
);
DROP POLICY IF EXISTS "Admins manage gallery albums" ON public.gallery_albums;
CREATE POLICY "Admins manage gallery albums" ON public.gallery_albums FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Gallery photos readable by permitted viewers" ON public.gallery_photos;
CREATE POLICY "Gallery photos readable by permitted viewers" ON public.gallery_photos FOR SELECT TO anon, authenticated USING (
 EXISTS (SELECT 1 FROM public.gallery_albums a WHERE a.id=album_id AND a.is_published AND (a.visibility='public' OR (auth.uid() IS NOT NULL AND (public.is_admin() OR (public.has_ever_paid_membership() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved'))))))
 OR public.is_admin()
);
DROP POLICY IF EXISTS "Admins manage gallery photos" ON public.gallery_photos;
CREATE POLICY "Admins manage gallery photos" ON public.gallery_photos FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON public.gallery_albums, public.gallery_photos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.gallery_albums, public.gallery_photos TO authenticated;
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('gallery-photos','gallery-photos',false,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
DROP POLICY IF EXISTS "Admins upload gallery photos" ON storage.objects;
CREATE POLICY "Admins upload gallery photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='gallery-photos' AND public.is_admin());
DROP POLICY IF EXISTS "Admins update gallery photos storage" ON storage.objects;
CREATE POLICY "Admins update gallery photos storage" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='gallery-photos' AND public.is_admin()) WITH CHECK (bucket_id='gallery-photos' AND public.is_admin());
DROP POLICY IF EXISTS "Admins delete gallery photos storage" ON storage.objects;
CREATE POLICY "Admins delete gallery photos storage" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='gallery-photos' AND public.is_admin());
DROP POLICY IF EXISTS "Permitted viewers read gallery photos storage" ON storage.objects;
CREATE POLICY "Permitted viewers read gallery photos storage" ON storage.objects FOR SELECT TO anon, authenticated USING (
 bucket_id='gallery-photos' AND EXISTS (
  SELECT 1 FROM public.gallery_photos gp JOIN public.gallery_albums ga ON ga.id=gp.album_id
  WHERE gp.storage_path=name AND ga.is_published AND (ga.visibility='public' OR (auth.uid() IS NOT NULL AND (public.is_admin() OR (public.has_ever_paid_membership() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.application_status='approved')))))
 )
);
-- END MIGRATION: 0018_photo_gallery.sql
