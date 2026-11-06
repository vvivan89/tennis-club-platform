'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Clock3 } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { EventCardActions } from '@/components/event-card-actions';
import { EventCardWeather } from '@/components/event-card-weather';
import { newsPathSlug } from '@/lib/news-slug';
import { eventPath } from '@/lib/event-slug';
import { eventDateRangeLabel } from '@/lib/event-format';
import {
  eventDisplayTitle,
  eventCardPriceLabel,
  type EventRow,
  withEventSeriesNumbers,
} from '@/lib/event-format';
import { sanitizeHtml } from '@/lib/sanitize-html';

type ClubEvent = EventRow & { status: 'draft' | 'published' | 'cancelled' };
const demoEvents: ClubEvent[] = [
  {
    id: 'demo-1',
    title: 'Friday Social Tennis',
    description: 'Friendly doubles rotation. Bring a water bottle and arrive 10 minutes early.',
    starts_at: '2026-10-23T19:30:00-07:00',
    registration_opens_at: '2026-10-23T19:00:00-07:00',
    registration_closes_at: '2026-10-23T19:20:00-07:00',
    capacity: 16,
    price_cents: 0,
    members_only: true,
    event_type: 'social',
    status: 'published',
  },
  {
    id: 'demo-2',
    title: 'Fall Doubles Tournament',
    description: 'Mixed doubles round-robin. Partner details collected after registration.',
    starts_at: '2026-11-07T09:00:00-08:00',
    registration_opens_at: '2026-10-22T19:00:00-07:00',
    registration_closes_at: '2026-11-06T18:00:00-08:00',
    capacity: 32,
    price_cents: 1500,
    members_only: true,
    event_type: 'tournament',
    status: 'published',
  },
  {
    id: 'demo-3',
    title: 'Adult Beginner Ladder',
    description: 'Introductory sessions for adult players.',
    starts_at: '2026-11-03T18:00:00-08:00',
    registration_opens_at: '2026-10-20T09:00:00-07:00',
    registration_closes_at: '2026-11-03T16:00:00-08:00',
    capacity: 8,
    price_cents: 4000,
    members_only: true,
    event_type: 'ladder',
    status: 'published',
  },
];
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Vancouver',
  }).format(new Date(value));
}
export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [events, setEvents] = useState<ClubEvent[]>(demoEvents);
  const [connected, setConnected] = useState(false);
  const [news, setNews] = useState<
    { id: string; title: string; body: string; published_at: string | null }[]
  >([]);
  const [publicAlbums, setPublicAlbums] = useState<
    {
      id: string;
      title: string;
      description: string;
      photos: { id: string; url: string; caption: string }[];
    }[]
  >([]);
  const [club, setClub] = useState<{
    club_name: string;
    short_name: string;
    contact_email: string;
    contact_phone: string;
    location_url: string;
    social_links: { url: string }[];
    location_query: string;
  }>({
    club_name: 'Port Coquitlam Tennis Club',
    short_name: 'PCTC',
    contact_email: '',
    contact_phone: '',
    location_url: '',
    social_links: [],
    location_query: 'Port Coquitlam, British Columbia',
  });
  useEffect(() => {
    setHydrated(true);
    let active = true;
    try {
      const db = createSupabaseBrowserClient();
      const now = new Date().toISOString();
      db.from('events')
        .select(
          'id,slug,title,description,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,price_cents,members_only,event_type,status,location,series_id,allow_plus_one,guest_price_cents',
        )
        .eq('status', 'published')
        .or(`starts_at.gte.${now},and(starts_at.lt.${now},ends_at.gte.${now})`)
        .order('starts_at')
        .limit(3)
        .then(({ data, error }) => {
          if (active && !error && data) {
            const visibleEvents = data as ClubEvent[];
            const seriesIds = [
              ...new Set(
                visibleEvents
                  .map((event) => event.series_id)
                  .filter((seriesId): seriesId is string => Boolean(seriesId)),
              ),
            ];
            const loadSeriesNumbers = seriesIds.length
              ? db.from('events').select('id,series_id,starts_at').in('series_id', seriesIds)
              : Promise.resolve({ data: [] });
            void loadSeriesNumbers.then(({ data: seriesSessions }) => {
              if (!active) return;
              setEvents(withEventSeriesNumbers(visibleEvents, seriesSessions ?? []) as ClubEvent[]);
              setConnected(true);
            });
          }
        });
      db.from('club_settings')
        .select(
          'club_name,short_name,contact_email,contact_phone,location_url,social_links,location_query',
        )
        .eq('id', 1)
        .maybeSingle()
        .then(({ data }) => {
          if (active && data)
            setClub({
              ...club,
              ...data,
              social_links: Array.isArray(data.social_links) ? data.social_links : [],
              location_query: data.location_query || 'Port Coquitlam, British Columbia',
            });
        });
      db.from('news')
        .select('id,title,body,published_at')
        .eq('published', true)
        .order('published_at', { ascending: false })
        .limit(6)
        .then(({ data }) => {
          if (active && data) setNews(data);
        });
      db.from('gallery_albums')
        .select('id,title,description')
        .eq('visibility', 'public')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(3)
        .then(async ({ data }) => {
          if (!active || !data) return;
          const albums = await Promise.all(
            data.map(async (album) => {
              const { data: photos } = await db
                .from('gallery_photos')
                .select('id,storage_path,caption')
                .eq('album_id', album.id)
                .order('sort_order')
                .limit(3);
              const previews = await Promise.all(
                (photos ?? []).map(async (photo) => {
                  const { data: link } = await db.storage
                    .from('gallery-photos')
                    .createSignedUrl(photo.storage_path, 3600);
                  return { id: photo.id, url: link?.signedUrl ?? '', caption: photo.caption || '' };
                }),
              );
              return { ...album, photos: previews.filter((p) => p.url) };
            }),
          );
          if (active) setPublicAlbums(albums);
        });
    } catch {
      /* Keep sample cards available until Supabase is configured. */
    }
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={club.club_name} shortName={club.short_name} active="home" />
      <section className="relative overflow-hidden border-b border-primary-foreground/10 bg-primary text-primary-foreground">
        <div className="page-container grid items-center gap-10 py-12 sm:py-16 lg:min-h-[540px] lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:py-20">
          <div className="max-w-xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-brand-lime">
              Community tennis
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-primary-foreground sm:text-5xl lg:text-6xl">
              Find your place on court.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-primary-foreground/80 sm:text-lg">
              Welcome to {club.club_name}. Find a game, join a club event, or get in touch to learn
              more about playing with us.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="bg-brand-lime text-foreground hover:bg-brand-lime/90"
              >
                <Link href="/events">View events</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-primary-foreground/35 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <Link href="/signup">Join the club</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <Link href="/contacts">Contact us</Link>
              </Button>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-2xl px-2 pb-8 pt-4 sm:px-4 sm:pb-10 lg:ml-auto">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-primary-foreground/20 shadow-2xl">
              <Image
                src="/images/pctc-courts-day.png"
                alt="Outdoor tennis courts in daylight"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 55vw"
                className="object-cover object-center"
              />
            </div>
            <div className="absolute -bottom-1 left-0 aspect-[4/3] w-36 overflow-hidden rounded-2xl border-4 border-primary shadow-xl sm:left-2 sm:w-48">
              <Image
                src="/images/gates-park-courts-evening.jpeg"
                alt="Gates Park tennis courts lit up in the evening"
                fill
                sizes="(max-width: 640px) 9rem, 12rem"
                className="object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-overlay/75 to-transparent px-2 pb-2 pt-6 text-[10px] font-medium text-overlay-foreground sm:text-xs">
                Gates Park at dusk
              </span>
            </div>
            <div className="absolute -right-1 top-0 aspect-[1.55] w-32 overflow-hidden rounded-2xl border-4 border-primary shadow-xl sm:right-1 sm:w-40">
              <Image
                src="/images/tennis-racket-ball.jpg"
                alt="A tennis ball resting on a racket"
                fill
                sizes="(max-width: 640px) 8rem, 10rem"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>
      <section id="news" className="bg-background py-14 sm:py-20">
        <div className="page-container">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Club updates</p>
              <h2 className="section-title">Latest news</h2>
            </div>
          </div>
          {news.length ? (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {news.map((item) => (
                <Card
                  key={item.id}
                  className="group flex h-full flex-col overflow-hidden rounded-xl border-border/80 transition-shadow hover:shadow-soft"
                >
                  <CardHeader>
                    <p className="text-xs text-muted-foreground">
                      {item.published_at
                        ? new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(
                            new Date(item.published_at),
                          )
                        : 'Club news'}
                    </p>
                    <h3 className="text-xl font-semibold">{item.title}</h3>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col">
                    <div
                      className="prose prose-sm mt-2 line-clamp-2 max-w-none overflow-hidden text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.body) }}
                    />
                    <Link
                      href={`/publications/${newsPathSlug(item, news)}`}
                      className="mt-4 inline-flex w-fit items-center gap-1 text-sm font-medium text-primary transition-colors hover:gap-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Read article <span aria-hidden="true">→</span>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Club announcements and news will appear here.
            </p>
          )}
          {publicAlbums.length > 0 && (
            <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {publicAlbums.map((album) => (
                <Card key={album.id} className="overflow-hidden rounded-xl border-border/80">
                  <CardHeader>
                    <Link href="/gallery" className="text-xl font-semibold hover:text-primary">
                      {album.title}
                    </Link>
                    {album.description && (
                      <p className="text-sm text-muted-foreground">{album.description}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Link
                      href="/gallery"
                      aria-label={`View ${album.title} gallery`}
                      className="grid grid-cols-3 gap-2"
                    >
                      {album.photos.map((photo) => (
                        <div key={photo.id} className="relative aspect-square">
                          <Image
                            src={photo.url}
                            alt={photo.caption || album.title}
                            fill
                            sizes="(max-width: 768px) 33vw, 11vw"
                            unoptimized
                            className="rounded object-cover"
                          />
                        </div>
                      ))}
                      {!album.photos.length && (
                        <span className="col-span-3 text-sm text-muted-foreground">
                          Photos coming soon.
                        </span>
                      )}
                    </Link>
                    <Link
                      href="/gallery"
                      className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                    >
                      View album →
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>
      <section id="events" className="border-y border-border bg-secondary/35 py-14 sm:py-20">
        <div className="page-container">
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">Get on court</p>
              <h2 className="section-title">Upcoming events</h2>
            </div>
            <Link href="/events" className="text-sm font-medium text-primary hover:underline">
              View all events
            </Link>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {events.slice(0, 3).map((event, i) => (
              <Card
                key={event.id}
                className="group flex h-full flex-col overflow-hidden rounded-xl border-border/80 transition-all duration-200 hover:-translate-y-1 hover:shadow-soft"
              >
                <Link
                  href={event.id.startsWith('demo-') ? '/events' : eventPath(event)}
                  className="flex flex-1 flex-col rounded-t-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <EventCardWeather
                    startsAt={event.starts_at}
                    endsAt={event.ends_at}
                    location={club.location_query.trim() || event.location?.trim() || ''}
                    status={event.status}
                    index={i}
                  />
                  <CardHeader className="pb-2">
                    <p className="flex items-center gap-2 text-xs font-medium text-brand-court">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {hydrated
                        ? eventDateRangeLabel(event.starts_at, event.ends_at)
                        : 'Session time'}
                    </p>
                    <h3 className="pt-1 text-2xl font-medium group-hover:text-primary">
                      {eventDisplayTitle(event)}
                    </h3>
                    {hydrated &&
                      new Date(event.starts_at).getTime() <= Date.now() &&
                      new Date(event.ends_at || event.starts_at).getTime() >= Date.now() && (
                        <span className="mt-2 inline-flex rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success-foreground dark:text-success-foreground">
                          In progress
                        </span>
                      )}
                  </CardHeader>
                  <CardContent className="pb-3">
                    <p className="min-h-12 text-sm leading-6 text-muted-foreground">
                      {event.description?.trim() || ''}
                      <span className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {!hydrated
                          ? 'Registration schedule'
                          : Date.now() >= new Date(event.registration_opens_at).getTime()
                            ? event.registration_closes_at
                              ? `Registration closes ${dateLabel(event.registration_closes_at)}`
                              : 'Registration is open'
                            : `Registration opens ${dateLabel(event.registration_opens_at)}`}
                      </span>
                    </p>
                  </CardContent>
                </Link>
                <CardContent className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
                  <span className="text-sm font-semibold">{eventCardPriceLabel(event)}</span>
                  {event.id.startsWith('demo-') ? (
                    <span className="text-xs text-muted-foreground">Preview</span>
                  ) : (
                    <EventCardActions eventId={event.id} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter
        clubName={club.club_name}
        shortName={club.short_name}
        socialLinks={club.social_links}
      />
      {!connected && (
        <div className="fixed inset-x-3 bottom-3 z-40 mx-auto w-fit max-w-[calc(100%-1.5rem)] rounded-full bg-foreground px-4 py-2.5 text-center text-[11px] text-background shadow-lg sm:inset-x-auto">
          Preview mode · Sample events shown · No live registrations or payments
        </div>
      )}
    </main>
  );
}
