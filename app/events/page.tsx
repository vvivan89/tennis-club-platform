import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getClubDisplay } from '@/lib/club-display';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { EventsBrowser } from '@/components/events-browser';
import { withLoadedEventSeriesNumbers } from '@/lib/event-format';
import { PendingTournamentInvitations } from '@/components/pending-tournament-invitations';
export default async function EventsPage() {
  const db = await createSupabaseServerClient();
  const [
    { data: club },
    { data: events, error },
    { data: counts },
    {
      data: { user },
    },
  ] = await Promise.all([
    db
      .from('club_settings')
      .select('club_name,short_name,social_links,location_query')
      .eq('id', 1)
      .maybeSingle(),
    db
      .from('events')
      .select(
        'id,slug,title,description,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,price_cents,members_only,status,event_type,location,series_id,allow_plus_one,guest_price_cents',
      )
      .in('status', ['published', 'cancelled'])
      .order('starts_at'),
    db.from('event_public_counts').select('event_id,confirmed_count'),
    db.auth.getUser(),
  ]);
  const numberedEvents = await withLoadedEventSeriesNumbers(events ?? [], db);
  const now = Date.now();
  const upcoming = numberedEvents.filter(
    (e) => new Date(e.ends_at || e.starts_at).getTime() >= now,
  );
  const past = numberedEvents.filter((e) => new Date(e.ends_at || e.starts_at).getTime() < now);
  let manager = false;
  if (user) {
    const { data: profile } = await db
      .from('profiles')
      .select('role,application_status')
      .eq('id', user.id)
      .maybeSingle();
    manager =
      profile?.application_status === 'approved' &&
      ['admin', 'organizer'].includes(profile.role ?? '');
  }
  const { clubName, shortName, socialLinks: socials } = getClubDisplay(club);
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} active="events" />
      <div className="page-container flex-1 py-12 sm:py-16">
        <PendingTournamentInvitations />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">On and off the court</p>
            <h1 className="section-title">Club events</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              Browse social sessions, events, and tournaments hosted by {clubName}.
            </p>
          </div>
          {manager && (
            <Button asChild>
              <Link href="/admin/events/create">Create event</Link>
            </Button>
          )}
        </div>
        {error ? (
          <p role="alert" className="mt-8 text-sm text-destructive">
            Events could not be loaded. Please try again later.
          </p>
        ) : (
          <EventsBrowser
            events={upcoming}
            pastEvents={past}
            counts={counts ?? []}
            defaultLocation={club?.location_query || 'Port Coquitlam, British Columbia'}
          />
        )}
      </div>
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socials} />
    </main>
  );
}
