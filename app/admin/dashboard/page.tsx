import { SiteFooter } from '@/components/site-footer';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminNav } from '@/components/admin-nav';

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/dashboard');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role,full_name')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role === 'organizer') redirect('/admin/organizer-dashboard');
  if (profile?.role !== 'admin') redirect('/member/dashboard');
  const [
    { count: memberCount },
    { data: profiles },
    { data: memberships },
    { data: payments },
    { data: familyMembers },
    { data: events },
    { data: settings },
    { data: registrations },
    { data: promotions },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('application_status', 'approved')
      .eq('account_kind', 'member'),
    supabase
      .from('profiles')
      .select('id,full_name,email,application_status')
      .eq('application_status', 'approved')
      .eq('account_kind', 'member'),
    supabase
      .from('memberships')
      .select('id,user_id,status,payment_status,created_at,ends_on')
      .order('created_at', { ascending: false }),
    supabase
      .from('payments')
      .select('business_record_id,status,succeeded_at,created_at')
      .eq('purpose', 'membership')
      .order('created_at', { ascending: false }),
    supabase
      .from('membership_family_members')
      .select('family_id,user_id,status,created_at,membership_families(paid_at,season_year)')
      .in('status', ['confirmed', 'removed_next_season'])
      .order('created_at', { ascending: false }),
    supabase
      .from('events')
      .select('id,title,event_type,starts_at,status,capacity,registration_closes_at')
      .eq('status', 'published'),
    supabase
      .from('membership_plan_settings')
      .select('season_start_month,season_start_day,season_end_month,season_end_day')
      .eq('id', 1)
      .maybeSingle(),
    supabase.from('registrations').select('event_id,user_id,status,created_at'),
    supabase.from('event_waitlist_promotions').select('event_id,user_id,promoted_at'),
  ]);
  const paymentByRecord = new Map<string, boolean>();
  for (const payment of payments ?? []) {
    if (!payment.business_record_id || paymentByRecord.has(payment.business_record_id)) continue;
    // Results are newest first: use the latest payment state so an older success
    // cannot hide a later full refund.
    paymentByRecord.set(
      payment.business_record_id,
      payment.status === 'succeeded' || payment.status === 'partially_refunded',
    );
  }
  const paidFamilyIds = new Set(
    [...paymentByRecord.entries()]
      .filter(([recordId, paid]) => recordId.startsWith('family:') && paid)
      .map(([recordId]) => recordId.slice('family:'.length)),
  );
  const paidFamilyMembers = new Set<string>();
  for (const member of familyMembers ?? []) {
    const relation = member.membership_families;
    const family = Array.isArray(relation) ? relation[0] : relation;
    if (family?.paid_at || paidFamilyIds.has(member.family_id))
      paidFamilyMembers.add(member.user_id);
  }
  const latestMembershipByUser = new Map<string, NonNullable<typeof memberships>[number]>();
  for (const membership of memberships ?? [])
    if (!latestMembershipByUser.has(membership.user_id))
      latestMembershipByUser.set(membership.user_id, membership);
  const overdue = (profiles ?? [])
    .flatMap((member) => {
      const m = latestMembershipByUser.get(member.id);
      if (!m || !['active', 'expired'].includes(m.status)) return [];
      const paid =
        paidFamilyMembers.has(member.id) ||
        m.payment_status === 'paid' ||
        paymentByRecord.get(m.id) === true;
      if (paid) return [];
      return [
        { ...member, membershipStatus: m.status, createdAt: m.created_at, endsOn: m.ends_on },
      ];
    })
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  const paidCount = (profiles ?? []).filter((member) => {
    // A paid family record covers its confirmed members even if their individual
    // membership rows remain pending; mirror the Members page's family logic.
    if (paidFamilyMembers.has(member.id)) return true;
    const m = latestMembershipByUser.get(member.id);
    if (!m || !['active', 'expired'].includes(m.status)) return false;
    return m.payment_status === 'paid' || paymentByRecord.get(m.id) === true;
  }).length;
  const pendingCount = (profiles ?? []).filter((member) => {
    const m = latestMembershipByUser.get(member.id);
    return m?.status === 'pending' && !paidFamilyMembers.has(member.id);
  }).length;
  const now = new Date();
  const startMonth = settings?.season_start_month ?? 4,
    startDay = settings?.season_start_day ?? 1,
    endMonth = settings?.season_end_month ?? 9,
    endDay = settings?.season_end_day ?? 30;
  const seasonStart = new Date(now.getFullYear(), startMonth - 1, startDay, 0, 0, 0, 0);
  const seasonEnd = new Date(now.getFullYear(), endMonth - 1, endDay, 23, 59, 59, 999);
  const seasonStartKey = startMonth * 100 + startDay,
    seasonEndKey = endMonth * 100 + endDay,
    todayKey = (now.getMonth() + 1) * 100 + now.getDate();
  if (todayKey < seasonStartKey) {
    seasonStart.setFullYear(now.getFullYear());
    seasonEnd.setFullYear(now.getFullYear());
  } else if (todayKey > seasonEndKey) {
    seasonStart.setFullYear(now.getFullYear());
    seasonEnd.setFullYear(now.getFullYear());
  }
  const seasonEvents = (events ?? []).filter(
    (event) =>
      event.starts_at &&
      new Date(event.starts_at) >= seasonStart &&
      new Date(event.starts_at) <= seasonEnd,
  );
  const upcomingEvents = seasonEvents.filter((event) => new Date(event.starts_at) > now).length;
  const pastEvents = seasonEvents.filter((event) => new Date(event.starts_at) <= now).length;
  const registrationRows = registrations ?? [];
  const promotionRows = promotions ?? [];
  const attendanceGroups = new Map<
    string,
    {
      events: typeof seasonEvents;
      registered: number[];
      filled: number[];
      excess: number[];
      vacant: number[];
      unpromoted: number[];
      promoted: number[];
    }
  >();
  for (const event of seasonEvents) {
    const key = (event.title || 'Untitled event').trim().toLocaleLowerCase();
    let group = attendanceGroups.get(key);
    if (!group) {
      group = {
        events: [],
        registered: [],
        filled: [],
        excess: [],
        vacant: [],
        unpromoted: [],
        promoted: [],
      };
      attendanceGroups.set(key, group);
    }
    group.events.push(event);
    const cutoff = event.registration_closes_at
      ? new Date(event.registration_closes_at).getTime()
      : new Date(event.starts_at).getTime();
    const eventRegs = registrationRows.filter(
      (r) => r.event_id === event.id && new Date(r.created_at).getTime() <= cutoff,
    );
    const uniqueUsers = new Set(eventRegs.map((r) => r.user_id));
    const total = uniqueUsers.size;
    const capacity = Number(event.capacity || 0);
    const promotedUsers = new Set(
      promotionRows
        .filter(
          (p) =>
            p.event_id === event.id &&
            new Date(p.promoted_at).getTime() <= new Date(event.starts_at).getTime(),
        )
        .map((p) => p.user_id),
    );
    group.registered.push(total);
    group.filled.push(Math.min(total, capacity));
    group.excess.push(Math.max(total - capacity, 0));
    group.vacant.push(Math.max(capacity - total, 0));
    group.unpromoted.push(Math.max(total - capacity, 0));
    group.promoted.push(promotedUsers.size);
  }
  const attendanceStats = [...attendanceGroups.entries()]
    .map(([key, g]) => ({
      key,
      title: g.events[0]?.title || 'Untitled event',
      sessions: g.events.length,
      registered: average(g.registered),
      filled: average(g.filled),
      excess: average(g.excess),
      vacant: average(g.vacant),
      unpromoted: average(g.unpromoted),
      promoted: average(g.promoted),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
  function average(values: number[]) {
    return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
  }
  const wholeCount = (value: number) => String(Math.round(value));
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Club administration</p>
        <h1 className="section-title">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Welcome{profile.full_name ? `, ${profile.full_name}` : ''}.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Members</CardDescription>
              <CardTitle className="text-3xl">{memberCount ?? '—'}</CardTitle>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Paid</p>
                  <p className="font-semibold">{paidCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Overdue</p>
                  <p className="font-semibold">{overdue.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pending</p>
                  <p className="font-semibold">{pendingCount}</p>
                </div>
              </div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Published events this season</CardDescription>
              <CardTitle className="text-3xl">{seasonEvents.length}</CardTitle>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Upcoming</p>
                  <p className="font-semibold">{upcomingEvents}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Past</p>
                  <p className="font-semibold">{pastEvents}</p>
                </div>
              </div>
            </CardHeader>
          </Card>
        </div>
        <section className="mt-8">
          <div>
            <h2 className="text-xl font-semibold">Attendance statistics by event type</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Recurring sessions with the same title are grouped together. Bars show average
              registrations at cutoff; the contrasting segment represents registrations above
              capacity. Hover or focus a bar for session and waitlist details.
            </p>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-card p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-primary" />
                Within capacity
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-warning" />
                Waitlisted above capacity
              </span>
            </div>
            <div className="space-y-5">
              {attendanceStats.map((row) => {
                const max = Math.max(1, ...attendanceStats.map((x) => x.registered));
                const filledWidth = row.registered ? (row.filled / max) * 100 : 0;
                const excessWidth = row.registered ? (row.excess / max) * 100 : 0;
                return (
                  <div
                    key={row.key}
                    className="grid gap-2 sm:grid-cols-[minmax(8rem,13rem)_minmax(0,1fr)_3rem] sm:items-center"
                  >
                    <div className="truncate text-sm font-medium" title={row.title}>
                      {row.title}
                    </div>
                    <div
                      className="h-7 w-full overflow-visible rounded-md bg-muted/60"
                      title={`${row.title}: ${wholeCount(row.registered)} average registered; ${row.sessions} sessions; ${wholeCount(row.vacant)} average vacant spots; ${wholeCount(row.unpromoted)} average waitlisted without a spot; ${wholeCount(row.promoted)} average promoted from waitlist`}
                    >
                      <div
                        className="flex h-7 min-w-0 overflow-visible rounded-md"
                        style={{ width: `${Math.max(0, filledWidth + excessWidth)}%` }}
                      >
                        <div
                          className="h-full rounded-l-md bg-primary"
                          style={{
                            width: row.registered
                              ? `${(row.filled / row.registered) * 100}%`
                              : '0%',
                          }}
                        />
                        <div
                          className="h-full rounded-r-md bg-warning"
                          style={{
                            width: row.registered
                              ? `${(row.excess / row.registered) * 100}%`
                              : '0%',
                          }}
                        />
                      </div>
                    </div>
                    <div
                      className="text-right text-sm tabular-nums text-muted-foreground"
                      title="Average total registrations including waitlist"
                    >
                      {wholeCount(row.registered)}
                    </div>
                    <div className="text-xs text-muted-foreground sm:col-start-2">
                      {row.sessions} sessions · {wholeCount(row.vacant)} vacant ·{' '}
                      {wholeCount(row.unpromoted)} waitlisted without a spot ·{' '}
                      {wholeCount(row.promoted)} promoted on average
                    </div>
                  </div>
                );
              })}
              {!attendanceStats.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  No published events in the current season.
                </p>
              )}
            </div>
          </div>
        </section>
        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Overdue membership fees</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Approved members with an active or expired membership and no recorded payment for
                their latest membership.
              </p>
            </div>
            <Link
              href="/admin/members"
              className="text-sm font-medium text-primary hover:underline"
            >
              Manage members
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Membership status</th>
                  <th className="px-4 py-3 font-medium">Membership created</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {m.full_name || '—'}
                    </td>
                    <td className="px-4 py-3">{m.email}</td>
                    <td className="px-4 py-3 capitalize">{m.membershipStatus}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {new Date(m.createdAt).toLocaleDateString('en-CA')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{m.endsOn || 'No expiry date'}</td>
                  </tr>
                ))}
                {!overdue.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                      No overdue membership fees found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <p className="mt-6 text-sm text-muted-foreground">
          Manage club information, member records, events, documents, and published website news
          using the sections above.
        </p>
      </div>
      <SiteFooter />
    </main>
  );
}
