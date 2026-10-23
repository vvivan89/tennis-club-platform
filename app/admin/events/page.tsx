import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { AdminNav } from '@/components/admin-nav';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { eventEditPath } from '@/lib/event-slug';
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
      'id,slug,title,starts_at,ends_at,status,capacity,price_cents,series_id,created_by,organizer_id',
    );
  if (me?.role === 'organizer')
    eventQuery = eventQuery.or(`created_by.eq.${user.id},organizer_id.eq.${user.id}`);
  const [{ data: events, error }, { data: club }] = await Promise.all([
    eventQuery.order('starts_at', { ascending: false }),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
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
          <div className="mt-7 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  {[
                    'Event',
                    'Starts',
                    'Ends',
                    'Capacity',
                    'Price',
                    'Status',
                    'Series',
                    'Actions',
                  ].map((x) => (
                    <th key={x} className="whitespace-nowrap px-4 py-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(events ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{e.title}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {new Date(e.starts_at).toLocaleString('en-CA')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {e.ends_at ? new Date(e.ends_at).toLocaleString('en-CA') : '—'}
                    </td>
                    <td className="px-4 py-3">{e.capacity}</td>
                    <td className="px-4 py-3">
                      {e.price_cents === 0
                        ? 'Free'
                        : new Intl.NumberFormat('en-CA', {
                            style: 'currency',
                            currency: 'CAD',
                          }).format(e.price_cents / 100)}
                    </td>
                    <td className="px-4 py-3 capitalize">{e.status}</td>
                    <td className="px-4 py-3">{e.series_id ? 'Recurring' : 'One-off'}</td>
                    <td className="px-4 py-3">
                      <Button asChild size="sm" variant="outline">
                        <Link href={eventEditPath(e)}>Edit</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events?.length && (
              <p className="p-4 text-sm text-muted-foreground">
                No events found. Create your first event to get started.
              </p>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Each recurring occurrence is managed as an individual session. Waitlist promotion is
          automatic when a participant withdraws or is removed.
        </p>
      </div>
      <SiteFooter
        clubName={club?.club_name}
        shortName={club?.short_name}
        socialLinks={
          Array.isArray(club?.social_links) ? (club.social_links as { url: string }[]) : []
        }
      />
    </main>
  );
}
