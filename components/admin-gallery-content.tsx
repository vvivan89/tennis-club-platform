'use client';
import Image from 'next/image';
import { TennisLoader } from '@/components/tennis-loader';
import { FloatingFeedback } from '@/components/floating-feedback';
import { AdminSectionTabs } from '@/components/admin-section-tabs';
import { useEffect, useState, type FormEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { AdminNav } from '@/components/admin-nav';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApprovedAdminPage } from '@/hooks/use-approved-admin-page';

type Album = {
  id: string;
  title: string;
  description: string;
  visibility: 'public' | 'members';
  is_published: boolean;
  created_at: string;
};
type Photo = {
  id: string;
  album_id: string;
  storage_path: string;
  caption: string;
  sort_order: number;
  alt_text?: string | null;
};
export function AdminGalleryContent({ embedded = false }: { embedded?: boolean }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'members'>('public');
  const [published, setPublished] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);
  async function load() {
    const db = createSupabaseBrowserClient();
    const [{ data: a }, { data: p }] = await Promise.all([
      db.from('gallery_albums').select('*').order('created_at', { ascending: false }),
      db.from('gallery_photos').select('*').order('sort_order').order('created_at'),
    ]);
    setAlbums((a ?? []) as Album[]);
    setPhotos((p ?? []) as Photo[]);
  }
  useApprovedAdminPage('/login?next=/admin/website?tab=gallery', () => void load());
  async function createAlbum(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const db = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      const { data, error } = await db
        .from('gallery_albums')
        .insert({
          title: title.trim(),
          description: description.trim(),
          visibility,
          is_published: published,
          created_by: user?.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      setTitle('');
      setDescription('');
      setSelectedAlbum(data.id);
      setMessage('Album created. Upload photos below.');
      await load();
    } catch (e) {
      console.error('[Gallery admin] Album creation failed', e);
      setError('Could not create album. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function uploadPhotos(e: FormEvent) {
    e.preventDefault();
    if (!selectedAlbum || !files.length) {
      setError('Choose an album and at least one image.');
      return;
    }
    setError('');
    setMessage('');
    setBusy(true);
    const db = createSupabaseBrowserClient();
    try {
      const {
        data: { user },
      } = await db.auth.getUser();
      for (const file of files) {
        if (
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size > 10 * 1024 * 1024
        )
          throw new Error(`${file.name}: use JPEG, PNG, or WebP up to 10 MB.`);
        const path = `${selectedAlbum}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: uploadError } = await db.storage
          .from('gallery-photos')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: insertError } = await db.from('gallery_photos').insert({
          album_id: selectedAlbum,
          storage_path: path,
          caption: '',
          alt_text: file.name.replace(/\.[^.]+$/, ''),
          uploaded_by: user?.id,
        });
        if (insertError) {
          await db.storage.from('gallery-photos').remove([path]);
          throw insertError;
        }
      }
      setFiles([]);
      const input = document.getElementById('gallery-files') as HTMLInputElement | null;
      if (input) input.value = '';
      setMessage('Photos uploaded.');
      await load();
    } catch (e) {
      console.error('[Gallery admin] Photo upload failed', e);
      setError('Could not upload photos. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function updateAlbum(album: Album, patch: Partial<Album>) {
    const db = createSupabaseBrowserClient();
    const { error } = await db.from('gallery_albums').update(patch).eq('id', album.id);
    if (error) {
      console.error('[Gallery admin] Album update failed', error);
      setError('Could not update album. Please try again.');
      return;
    }
    await load();
  }
  async function updateCaption(photo: Photo, caption: string) {
    const db = createSupabaseBrowserClient();
    const { error } = await db.from('gallery_photos').update({ caption }).eq('id', photo.id);
    if (error) {
      console.error('[Gallery admin] Caption update failed', error);
      setError('Could not update photo caption. Please try again.');
    } else await load();
  }
  async function removePhoto(photo: Photo) {
    const db = createSupabaseBrowserClient();
    const { error: se } = await db.storage.from('gallery-photos').remove([photo.storage_path]);
    if (se) {
      console.error('[Gallery admin] Photo storage deletion failed', se);
      setError('Could not delete photo. Please try again.');
      return;
    }
    const { error } = await db.from('gallery_photos').delete().eq('id', photo.id);
    if (error) {
      console.error('[Gallery admin] Photo deletion failed', error);
      setError('Could not delete photo. Please try again.');
    } else await load();
  }
  async function removeAlbum(album: Album) {
    const db = createSupabaseBrowserClient();
    const paths = photos.filter((p) => p.album_id === album.id).map((p) => p.storage_path);
    if (paths.length) {
      const { error } = await db.storage.from('gallery-photos').remove(paths);
      if (error) {
        console.error('[Gallery admin] Album photo cleanup failed', error);
        setError('Could not delete album. Please try again.');
        return;
      }
    }
    const { error } = await db.from('gallery_albums').delete().eq('id', album.id);
    if (error) {
      console.error('[Gallery admin] Album deletion failed', error);
      setError('Could not delete album. Please try again.');
    } else {
      if (selectedAlbum === album.id) setSelectedAlbum('');
      await load();
    }
  }
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      {!embedded && <AdminNav />}
      <FloatingFeedback error={error} message={message} />
      <div className="page-container flex-1 py-10">
        {!embedded && <AdminSectionTabs section="publications" />}
        <p className="eyebrow">Website content</p>
        <h1 className="section-title">Gallery</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Create albums, choose who can view them, and upload photos. Public albums are promoted in
          Latest News on the homepage.
        </p>
        <form
          onSubmit={createAlbum}
          className="mt-6 max-w-2xl space-y-4 rounded-xl border border-border p-5"
        >
          <h2 className="text-lg font-semibold">Create album</h2>
          <label className="block space-y-1.5 text-sm font-medium">
            Album title
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={180}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Description (optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Visibility
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'members')}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="public">Public — anyone can view</option>
              <option value="members">
                Members only — approved users who have paid a membership fee
              </option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />{' '}
            Publish album immediately
          </label>
          <Button disabled={busy}>
            {busy ? <TennisLoader compact label="Saving" /> : 'Create album'}
          </Button>
        </form>
        <form
          onSubmit={uploadPhotos}
          className="mt-8 max-w-2xl space-y-4 rounded-xl border border-border p-5"
        >
          <h2 className="text-lg font-semibold">Upload photos</h2>
          <label className="block space-y-1.5 text-sm font-medium">
            Album
            <select
              required
              value={selectedAlbum}
              onChange={(e) => setSelectedAlbum(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">Choose an album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {a.is_published ? '' : ' (draft)'}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Images
            <input
              id="gallery-files"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm"
            />
            <span className="text-xs font-normal text-muted-foreground">
              JPEG, PNG, or WebP; up to 10 MB per image.
            </span>
          </label>
          <Button disabled={busy || !selectedAlbum || !files.length}>
            {busy ? (
              <TennisLoader compact label="Uploading" />
            ) : (
              `Upload ${files.length || ''} photo${files.length === 1 ? '' : 's'}`
            )}
          </Button>
        </form>
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Albums</h2>
          <div className="mt-3 space-y-4">
            {albums.map((album) => (
              <article key={album.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{album.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {album.description || 'No description'} ·{' '}
                      {album.visibility === 'public' ? 'Public' : 'Members only'} ·{' '}
                      {photos.filter((p) => p.album_id === album.id).length} photos
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      setConfirmation({
                        title: 'Delete album?',
                        description: `Delete album “${album.title}” and all its photos? This cannot be undone.`,
                        onConfirm: () => void removeAlbum(album),
                      })
                    }
                  >
                    Delete album
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={album.is_published}
                      onChange={(e) => void updateAlbum(album, { is_published: e.target.checked })}
                    />{' '}
                    Published
                  </label>
                  <label className="flex items-center gap-2">
                    Visibility
                    <select
                      value={album.visibility}
                      onChange={(e) =>
                        void updateAlbum(album, {
                          visibility: e.target.value as 'public' | 'members',
                        })
                      }
                      className="rounded-md border border-input bg-background px-2 py-1"
                    >
                      <option value="public">Public</option>
                      <option value="members">Members only</option>
                    </select>
                  </label>
                  <Button size="sm" variant="outline" onClick={() => setSelectedAlbum(album.id)}>
                    Upload to this album
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {photos
                    .filter((p) => p.album_id === album.id)
                    .map((photo) => (
                      <PhotoAdmin
                        key={photo.id}
                        photo={photo}
                        onCaption={(caption) => updateCaption(photo, caption)}
                        onDelete={() =>
                          setConfirmation({
                            title: 'Delete photo?',
                            description: 'Delete this photo? This cannot be undone.',
                            onConfirm: () => void removePhoto(photo),
                          })
                        }
                      />
                    ))}
                </div>
              </article>
            ))}
            {!albums.length && (
              <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                No albums created yet.
              </p>
            )}
          </div>
        </section>
      </div>
      {!embedded && <SiteFooter />}
      {confirmation && (
        <ConfirmDialog
          open
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.onConfirm;
            setConfirmation(null);
            action();
          }}
        />
      )}
    </main>
  );
}
function PhotoAdmin({
  photo,
  onCaption,
  onDelete,
}: {
  photo: Photo;
  onCaption: (caption: string) => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState(photo.caption);
  useEffect(() => {
    createSupabaseBrowserClient()
      .storage.from('gallery-photos')
      .createSignedUrl(photo.storage_path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl ?? ''));
  }, [photo.storage_path]);
  return (
    <div className="min-w-0 rounded-lg border border-border p-2">
      {url ? (
        <div className="relative aspect-square w-full">
          <Image
            src={url}
            alt={photo.alt_text || ''}
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
            unoptimized
            className="rounded object-cover"
          />
        </div>
      ) : (
        <div className="aspect-square animate-pulse rounded bg-muted" />
      )}
      <label className="mt-2 block text-xs">
        Caption
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => {
            if (caption !== photo.caption) onCaption(caption);
          }}
          maxLength={300}
          className="mt-1 w-full rounded border border-input bg-background px-2 py-1"
        />
      </label>
      <Button size="sm" variant="destructive" className="mt-2 w-full" onClick={onDelete}>
        Delete photo
      </Button>
    </div>
  );
}
