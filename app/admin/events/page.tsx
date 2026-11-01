import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { AdminNav } from '@/components/admin-nav';
import { ClubSiteFooter } from '@/components/club-site-footer';
import { Button } from '@/components/ui/button';
import { AdminEventsTable } from '@/components/admin-events-table';
export default async function EventsAdminPage() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/admin/events');
  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!['admin', 'organizer'].includes(me?.role ?? '')) redirect('/member/dashboard');
  let eventQuery = db
    .from('events')
    .select(
      'id,slug,title,starts_at,ends_at,status,capacity,price_cents,series_id,created_by,organizer_id,event_type,tournament_format,social_doubles_ladder_id',
    );
  if (me?.role === 'organizer')
    eventQuery = eventQuery.or(`created_by.eq.${user.id},organizer_id.eq.${user.id}`);
  const [{ data: events, error }, { data: club }] = await Promise.all([
    eventQuery.order('starts_at', { ascending: false }),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  const competitionIds = [
    ...new Set((events ?? []).map((event) => event.social_doubles_ladder_id).filter(Boolean)),
  ];
  const { data: competitions } = competitionIds.length
    ? await db.from('social_doubles_ladders').select('id,competition_type').in('id', competitionIds)
    : { data: [] };
  const leagueIds = new Set(
    (competitions ?? [])
      .filter((competition) => competition.competition_type === 'league')
      .map((competition) => competition.id),
  );
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">
              {me?.role === 'organizer' ? 'Organizer portal' : 'Event management'}
            </p>
            <h1 className="section-title">{me?.role === 'organizer' ? 'Your events' : 'Events'}</h1>
          </div>
          <Button asChild>
            <Link href="/admin/events/create">Create Event</Link>
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-5 text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <AdminEventsTable
            events={
              (events ?? []).map((event) => ({
                ...event,
                is_league_tournament: leagueIds.has(event.social_doubles_ladder_id),
              })) as Array<{
                id: string;
                slug: string | null;
                title: string;
                starts_at: string;
                ends_at: string | null;
                status: string;
                capacity: number;
                price_cents: number;
                series_id: string | null;
                created_by: string | null;
                organizer_id: string | null;
                event_type: string | null;
                tournament_format: string | null;
                social_doubles_ladder_id: string | null;
                is_league_tournament: boolean;
              }>
            }
          />
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Each recurring occurrence is managed as an individual session. Waitlist promotion is
          automatic when a participant withdraws or is removed.
        </p>
      </div>
      <ClubSiteFooter club={club} />
    </main>
  );
}
