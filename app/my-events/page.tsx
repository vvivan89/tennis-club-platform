import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SiteHeader } from '@/components/site-header';
import { ClubSiteFooter } from '@/components/club-site-footer';
import { eventPath } from '@/lib/event-slug';
import { eventDisplayTitle, withLoadedEventSeriesNumbers } from '@/lib/event-format';

export const dynamic = 'force-dynamic';

export default async function MyEventsPage() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/my-events');
  const [{ data: profile }, { data: club }] = await Promise.all([
    db.from('profiles').select('account_kind').eq('id', user.id).maybeSingle(),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  if (profile?.account_kind !== 'event_guest') redirect('/member/dashboard');

  const { data: entries } = await db
    .from('tournament_participants')
    .select(
      'id,event_id,category,status,payment_status,confirmation_status,event:events(id,slug,title,starts_at,ends_at,series_id)',
    )
    .eq('user_id', user.id)
    .in('status', ['registered', 'provisional'])
    .order('created_at', { ascending: false });
  const byEvent = new Map<string, { event: Record<string, unknown>; entries: typeof entries }>();
  for (const entry of entries ?? []) {
    const event = Array.isArray(entry.event) ? entry.event[0] : entry.event;
    if (!event) continue;
    const current = byEvent.get(entry.event_id);
    if (current) current.entries?.push(entry);
    else byEvent.set(entry.event_id, { event: event as Record<string, unknown>, entries: [entry] });
  }
  const groupedEvents = [...byEvent.values()].map(
    (group) => group.event as { id: string; starts_at: string; series_id: string | null },
  );
  const numberedEvents = await withLoadedEventSeriesNumbers(groupedEvents, db);
  const seriesNumberByEventId = new Map(
    numberedEvents.map((event) => [event.id, event.series_number] as const),
  );
  for (const [eventId, group] of byEvent) {
    group.event = {
      ...group.event,
      series_number: seriesNumberByEventId.get(eventId) ?? null,
    };
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        clubName={club?.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club?.short_name || ''}
      />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Event-only account</p>
        <h1 className="section-title mt-2">My events</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Review your tournament and League entries, continue payment when your team is confirmed,
          and open each event page to update your details.
        </p>
        <div className="mt-7 space-y-3">
          {[...byEvent.values()].map(({ event, entries: eventEntries }) => {
            const title = eventDisplayTitle({
              title: String(event.title || 'Event'),
              series_number: typeof event.series_number === 'number' ? event.series_number : null,
            });
            const link = eventPath({
              id: String(event.id),
              slug: typeof event.slug === 'string' ? event.slug : null,
            });
            const waiting = eventEntries?.some((entry) => entry.confirmation_status === 'pending');
            const unpaid = eventEntries?.some((entry) =>
              ['pending', 'failed'].includes(entry.payment_status),
            );
            return (
              <article
                key={String(event.id)}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {new Date(String(event.starts_at)).toLocaleString('en-CA')}
                    </p>
                    <p className="mt-2 text-sm">
                      {waiting
                        ? 'Waiting for partner confirmation'
                        : unpaid
                          ? 'Registration saved · payment pending'
                          : 'Registration confirmed'}
                    </p>
                  </div>
                  <Link
                    className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                    href={link}
                  >
                    Open event
                  </Link>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {(eventEntries ?? []).map((entry) => (
                    <li key={entry.id}>
                      {entry.category} ·{' '}
                      {entry.confirmation_status === 'pending'
                        ? 'Awaiting confirmation'
                        : entry.payment_status === 'paid' || entry.payment_status === 'not_required'
                          ? 'Paid / no payment required'
                          : 'Payment pending'}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
          {!byEvent.size && (
            <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              You do not have any event registrations yet.
            </p>
          )}
        </div>
      </div>
      <ClubSiteFooter club={club} />
    </main>
  );
}
