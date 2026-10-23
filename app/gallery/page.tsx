'use client';
import Image from 'next/image';
import { TennisLoader } from '@/components/tennis-loader';
import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

type Album = {
  id: string;
  title: string;
  description: string;
  visibility: 'public' | 'members';
  created_at: string;
};
type Photo = {
  id: string;
  album_id: string;
  storage_path: string;
  caption: string;
  alt_text: string;
  sort_order: number;
  url?: string;
};
export default function GalleryPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [club, setClub] = useState({
    club_name: 'Port Coquitlam Tennis Club',
    short_name: 'PCTC',
    social_links: [] as { url: string }[],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Photo | null>(null);
  const [, setCanView] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      const db = createSupabaseBrowserClient();
      const [
        { data: clubData },
        {
          data: { user },
        },
      ] = await Promise.all([
        db
          .from('club_settings')
          .select('club_name,short_name,social_links')
          .eq('id', 1)
          .maybeSingle(),
        db.auth.getUser(),
      ]);
      if (clubData && alive)
        setClub({
          club_name: clubData.club_name || 'Port Coquitlam Tennis Club',
          short_name: clubData.short_name || 'PCTC',
          social_links: Array.isArray(clubData.social_links) ? clubData.social_links : [],
        });
      let paid = false;
      if (user) {
        const { data: profile } = await db
          .from('profiles')
          .select('role,application_status')
          .eq('id', user.id)
          .maybeSingle();
        if (profile?.role === 'admin') paid = true;
        else if (profile?.application_status === 'approved') {
          const { data } = await db.rpc('has_ever_paid_membership');
          paid = Boolean(data);
        }
      }
      if (alive) setCanView(paid);
      const { data: a, error: ae } = await db
        .from('gallery_albums')
        .select('id,title,description,visibility,created_at')
        .eq('is_published', true)
        .order('created_at', { ascending: false });
      if (ae) {
        if (alive) {
          setError('Gallery could not be loaded. Please try again later.');
          setLoading(false);
        }
        return;
      }
      const visible = (a ?? []).filter((x) => x.visibility === 'public' || paid) as Album[];
      const ids = visible.map((x) => x.id);
      let p: Photo[] = [];
      if (ids.length) {
        const { data: pd, error: pe } = await db
          .from('gallery_photos')
          .select('id,album_id,storage_path,caption,alt_text,sort_order')
          .in('album_id', ids)
          .order('sort_order')
          .order('created_at');
        if (pe) throw pe;
        p = await Promise.all(
          (pd ?? []).map(async (item) => {
            const { data } = await db.storage
              .from('gallery-photos')
              .createSignedUrl(item.storage_path, 3600);
            return { ...item, url: data?.signedUrl ?? '' };
          }),
        );
      }
      if (alive) {
        setAlbums(visible);
        setPhotos(p);
        setLoading(false);
      }
    }
    load().catch(() => {
      if (alive) {
        setError('Gallery could not be loaded. Please try again later.');
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  const currentIndex = selected ? photos.findIndex((p) => p.id === selected.id) : -1;
  function move(delta: number) {
    if (!photos.length) return;
    const next = photos[(currentIndex + delta + photos.length) % photos.length];
    setSelected(next);
  }
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={club.club_name} shortName={club.short_name} />
      <div className="page-container flex-1 py-10 sm:py-14">
        <p className="eyebrow">Life at the club</p>
        <h1 className="section-title">Gallery</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Photos from club events, tournaments, and time on court.
        </p>
        {loading ? (
          <TennisLoader label="Loading gallery" />
        ) : error ? (
          <p role="alert" className="mt-8 text-sm text-destructive">
            {error}
          </p>
        ) : !albums.length ? (
          <p className="mt-8 rounded-xl border border-border p-6 text-sm text-muted-foreground">
            No published albums are available yet.
          </p>
        ) : (
          <div className="mt-8 space-y-10">
            {albums.map((album) => {
              const items = photos.filter((p) => p.album_id === album.id);
              return (
                <section key={album.id}>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{album.title}</h2>
                      {album.description && (
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                          {album.description}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {album.visibility === 'public' ? 'Public album' : 'Members-only album'} ·{' '}
                      {items.length} photos
                    </span>
                  </div>
                  {items.length ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {items.map((photo) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => setSelected(photo)}
                          className="group overflow-hidden rounded-lg bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {photo.url ? (
                            <div className="relative aspect-square">
                              <Image
                                src={photo.url}
                                alt={photo.alt_text || photo.caption || album.title}
                                fill
                                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                                unoptimized
                                className="object-cover transition-transform duration-200 group-hover:scale-105"
                              />
                            </div>
                          ) : (
                            <div className="aspect-square" />
                          )}
                          {photo.caption && (
                            <span className="block px-3 py-2 text-xs text-muted-foreground">
                              {photo.caption}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No photos in this album yet.</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
      <SiteFooter
        clubName={club.club_name}
        shortName={club.short_name}
        socialLinks={club.social_links}
      />
      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setSelected(null)}
        >
          <button
            aria-label="Close photo"
            className="absolute right-5 top-4 text-3xl text-white"
            onClick={() => setSelected(null)}
          >
            ×
          </button>
          <button
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl text-white"
            onClick={(e) => {
              e.stopPropagation();
              move(-1);
            }}
          >
            ‹
          </button>
          {selected.url && (
            <Image
              src={selected.url}
              alt={selected.alt_text || selected.caption || ''}
              width={1600}
              height={1200}
              unoptimized
              className="max-h-[85vh] max-w-[88vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <button
            aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl text-white"
            onClick={(e) => {
              e.stopPropagation();
              move(1);
            }}
          >
            ›
          </button>
          {selected.caption && (
            <p className="absolute bottom-4 max-w-[80vw] text-center text-sm text-white">
              {selected.caption}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
