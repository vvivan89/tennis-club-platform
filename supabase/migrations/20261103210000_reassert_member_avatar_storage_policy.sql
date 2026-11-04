INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('member-avatars','member-avatars',true,3145728,
  ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE
SET public=true,file_size_limit=3145728,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/gif'];

DROP POLICY IF EXISTS "Members upload own avatar" ON storage.objects;
CREATE POLICY "Members upload own avatar" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='member-avatars'
  AND auth.uid() IS NOT NULL
  AND strpos(name,'/')>0
  AND split_part(name,'/',1)=auth.uid()::text
);

DROP POLICY IF EXISTS "Members update own avatar" ON storage.objects;
CREATE POLICY "Members update own avatar" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id='member-avatars'
  AND auth.uid() IS NOT NULL
  AND strpos(name,'/')>0
  AND split_part(name,'/',1)=auth.uid()::text
)
WITH CHECK (
  bucket_id='member-avatars'
  AND auth.uid() IS NOT NULL
  AND strpos(name,'/')>0
  AND split_part(name,'/',1)=auth.uid()::text
);

DROP POLICY IF EXISTS "Members delete own avatar" ON storage.objects;
CREATE POLICY "Members delete own avatar" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='member-avatars'
  AND auth.uid() IS NOT NULL
  AND strpos(name,'/')>0
  AND split_part(name,'/',1)=auth.uid()::text
);
