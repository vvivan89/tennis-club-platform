import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, CheckCircle2, Clock3, Users } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { AdminNav } from '@/components/admin-nav';
import { ClubSiteFooter } from '@/components/club-site-footer';
import { Button } from '@/components/ui/button';
import { eventEditPath } from '@/lib/event-slug';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export default async function OrganizerDashboardPage() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/admin/organizer-dashboard');
  const { data: profile } = await db
    .from('profiles')
    .select('role,full_name')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role === 'admin') redirect('/admin/dashboard');
  if (profile?.role !== 'organizer') redirect('/member/dashboard');
  const [{ data: events, error }, { data: club }] = await Promise.all([
    db
      .from('events')
      .select(
        'id,slug,title,starts_at,ends_at,status,capacity,price_cents,series_id,created_by,organizer_id',
      )
      .or(`created_by.eq.${user.id},organizer_id.eq.${user.id}`)
      .order('starts_at', { ascending: false }),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  const ids = (events ?? []).map((e) => e.id);
  const { data: registrations } = ids.length
    ? await db.from('registrations').select('event_id,status').in('event_id', ids)
    : { data: [] as { event_id: string; status: string }[] };
  const now = Date.now();
  const upcoming = (events ?? []).filter((e) => new Date(e.starts_at).getTime() >= now);
  const past = (events ?? []).filter((e) => new Date(e.starts_at).getTime() < now);
  const confirmed = (registrations ?? []).filter((r) => r.status === 'confirmed').length;
  const waitlisted = (registrations ?? []).filter((r) => r.status === 'waitlisted').length;
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Organizer portal</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="section-title">Dashboard</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Welcome{profile.full_name ? `, ${profile.full_name}` : ''}. This dashboard includes
              only events you organized.
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/events/create">Create event</Link>
          </Button>
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                Your events
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{events?.length ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                Upcoming
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{upcoming.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                Past sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{past.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Users className="h-4 w-4" />
                Registrations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{confirmed}</p>
              <p className="mt-1 text-xs text-muted-foreground">{waitlisted} waitlisted</p>
            </CardContent>
          </Card>
        </div>
        <section className="mt-9">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Your events</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Only sessions created by your account appear here.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/admin/events">View all your events</Link>
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error.message}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    {['Event', 'Starts', 'Status', 'Capacity', 'Registrations', 'Actions'].map(
                      (x) => (
                        <th key={x} className="whitespace-nowrap px-4 py-3 font-medium">
                          {x}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(events ?? []).slice(0, 12).map((e) => {
                    const rows = (registrations ?? []).filter((r) => r.event_id === e.id);
                    return (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">{e.title}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {new Date(e.starts_at).toLocaleString('en-CA')}
                        </td>
                        <td className="px-4 py-3 capitalize">{e.status}</td>
                        <td className="px-4 py-3">{e.capacity}</td>
                        <td className="px-4 py-3">
                          {rows.filter((r) => r.status === 'confirmed').length}
                          {rows.some((r) => r.status === 'waitlisted') && (
                            <span className="text-muted-foreground">
                              {' '}
                              · {rows.filter((r) => r.status === 'waitlisted').length} waitlisted
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="outline" asChild>
                            <Link href={eventEditPath(e)}>Manage</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!events?.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-7 text-center text-sm text-muted-foreground"
                      >
                        You have not created any events yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <ClubSiteFooter club={club} />
    </main>
  );
}
