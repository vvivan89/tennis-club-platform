import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getClubDisplay } from '@/lib/club-display';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MemberNav } from '@/components/member-nav';

export default async function DashboardPage() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');
  const [{ data: profile }, { data: registrations }, { data: suspensions }, { data: club }] =
    await Promise.all([
      db
        .from('profiles')
        .select(
          'full_name,email,role,date_of_birth,show_birthday_emoji,tennis_skill_level,application_status',
        )
        .eq('id', user.id)
        .maybeSingle(),
      db
        .from('registrations')
        .select(
          'id,event_id,status,payment_status,amount_cents,created_at,event:events(id,slug,title,starts_at,ends_at)',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      db
        .from('member_suspensions')
        .select('id,starts_on,ends_on,reason')
        .eq('user_id', user.id)
        .order('starts_on', { ascending: false }),
      db
        .from('club_settings')
        .select('club_name,short_name,social_links')
        .eq('id', 1)
        .maybeSingle(),
    ]);
  const [
    { data: latestMembership },
    { data: familyLink },
    { data: membershipSettings },
    { data: latestPayment },
  ] = await Promise.all([
    db
      .from('memberships')
      .select('id,membership_type,status,payment_status,created_at,starts_on,ends_on')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('membership_family_members')
      .select('family_id,status,membership_families(paid_at,season_year)')
      .eq('user_id', user.id)
      .in('status', ['confirmed', 'pending', 'removed_next_season'])
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('membership_plan_settings')
      .select(
        'single_price_cents,family_price_cents,season_start_month,season_start_day,season_end_month,season_end_day',
      )
      .eq('id', 1)
      .maybeSingle(),
    db
      .from('payments')
      .select('succeeded_at,created_at,business_record_id')
      .eq('user_id', user.id)
      .eq('purpose', 'membership')
      .eq('status', 'succeeded')
      .order('succeeded_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);
  let familyNames: string[] = [];
  let familyInfo: {
    paid_at: string | null;
    paid_by: string | null;
    payment_id: string | null;
    season_year: number;
  } | null = null;
  if (familyLink?.family_id) {
    const [{ data: familyRows }, { data: family }] = await Promise.all([
      db
        .from('membership_family_members')
        .select('user_id,status,profiles(full_name,email)')
        .eq('family_id', familyLink.family_id)
        .in('status', ['confirmed', 'pending', 'removed_next_season']),
      db
        .from('membership_families')
        .select('paid_at,paid_by,payment_id,season_year')
        .eq('id', familyLink.family_id)
        .maybeSingle(),
    ]);
    familyNames = (familyRows ?? []).map(
      (r) => r.profiles?.[0]?.full_name || r.profiles?.[0]?.email || 'Member',
    );
    familyInfo = family;
  }

  const seasonSettings = membershipSettings ?? {
    season_start_month: 4,
    season_start_day: 1,
    season_end_month: 9,
    season_end_day: 30,
  };
  const nowForSeason = new Date();
  const seasonStartThisYear = new Date(
    nowForSeason.getFullYear(),
    seasonSettings.season_start_month - 1,
    seasonSettings.season_start_day,
  );
  const seasonEndThisYear = new Date(
    nowForSeason.getFullYear(),
    seasonSettings.season_end_month - 1,
    seasonSettings.season_end_day,
    23,
    59,
    59,
    999,
  );
  const targetSeasonYear =
    nowForSeason < seasonStartThisYear
      ? nowForSeason.getFullYear()
      : nowForSeason > seasonEndThisYear
        ? nowForSeason.getFullYear() + 1
        : nowForSeason.getFullYear();
  const targetSeasonStart = `${targetSeasonYear}-${String(seasonSettings.season_start_month).padStart(2, '0')}-${String(seasonSettings.season_start_day).padStart(2, '0')}`;
  const targetSeasonEnd = `${targetSeasonYear}-${String(seasonSettings.season_end_month).padStart(2, '0')}-${String(seasonSettings.season_end_day).padStart(2, '0')}`;
  const familyPaidThisSeason = Boolean(
    familyInfo &&
    familyInfo.season_year === targetSeasonYear &&
    (familyInfo.paid_at || familyInfo.payment_id),
  );
  const individualMembershipCurrentSeason = Boolean(
    latestMembership &&
    latestMembership.starts_on === targetSeasonStart &&
    latestMembership.ends_on === targetSeasonEnd,
  );
  const latestPaymentForMembership =
    latestPayment?.business_record_id === latestMembership?.id ? latestPayment : null;

  if (profile?.application_status !== 'approved') {
    const { clubName, shortName, socialLinks: socials } = getClubDisplay(club);
    return (
      <main className="flex min-h-screen flex-col bg-background text-foreground">
        <SiteHeader clubName={clubName} shortName={shortName} />
        <div className="page-container flex-1 py-16">
          <p className="eyebrow">Member application</p>
          <h1 className="section-title">
            {profile?.application_status === 'dismissed'
              ? 'Application not approved'
              : 'Your registration is pending'}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
            {profile?.application_status === 'dismissed'
              ? 'Your membership application was not approved. Please contact the club if you have questions.'
              : 'Your account has been created. An administrator must approve your application before member features become available. You can continue browsing public pages while you wait.'}
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/events">Browse events</Link>
          </Button>
        </div>
        <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socials} />
      </main>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const activityRows = (registrations ?? []).map((r) => ({
    ...r,
    event: Array.isArray(r.event) ? r.event[0] : r.event,
  }));
  const past = activityRows.filter(
    (r) =>
      r.event?.starts_at &&
      new Date(r.event.starts_at).getTime() < Date.now() &&
      r.status === 'confirmed',
  );
  const upcoming = activityRows.filter(
    (r) =>
      r.event?.starts_at &&
      new Date(r.event.starts_at).getTime() >= Date.now() &&
      r.status === 'confirmed',
  );
  const waitlisted = activityRows.filter((r) => r.status === 'waitlisted');
  const cancelled = activityRows.filter((r) => r.status === 'cancelled');
  const activeSuspension = (suspensions ?? []).find(
    (s) => s.starts_on <= today && s.ends_on >= today,
  );
  const birthdayToday = Boolean(
    profile?.show_birthday_emoji &&
    profile.date_of_birth &&
    (() => {
      const [, month, day] = profile.date_of_birth.split('-').map(Number);
      const now = new Date();
      return now.getMonth() + 1 === month && now.getDate() === day;
    })(),
  );
  const { clubName, shortName, socialLinks: socials } = getClubDisplay(club);
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} />
      <MemberNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Member account</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="section-title">
              Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}
              {birthdayToday ? ' 🎂' : ''}
            </h1>
            <Link
              href="/member/profile"
              aria-label="Edit profile"
              title="Edit profile"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-accent"
            >
              <Pencil className="h-4 w-4" />
            </Link>
          </div>
          {['admin', 'organizer'].includes((profile?.role ?? '').toLowerCase()) && (
            <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium capitalize text-muted-foreground">
              {profile?.role === 'admin' ? 'Admin' : 'Organizer'}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Tennis skill level: {profile?.tennis_skill_level || 'Not set — update your profile'}
        </p>
        {activeSuspension && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
          >
            <h2 className="font-semibold text-destructive">Your account is currently suspended</h2>
            <p className="mt-1 text-sm">
              Suspension dates: {activeSuspension.starts_on} to {activeSuspension.ends_on}.
            </p>
            <p className="mt-1 text-sm">Reason: {activeSuspension.reason}</p>
            <p className="mt-2 text-sm">You cannot register for club events during this period.</p>
          </div>
        )}
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Membership overview</CardTitle>
              <CardDescription>Your membership type and current family group.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-medium">
                {familyLink?.status === 'confirmed'
                  ? 'Family membership'
                  : familyLink?.status === 'pending'
                    ? 'Family invitation pending'
                    : familyLink?.status === 'removed_next_season'
                      ? 'Family membership · leaving next season'
                      : individualMembershipCurrentSeason && latestMembership?.membership_type
                        ? String(latestMembership.membership_type).toLowerCase().includes('family')
                          ? 'Family membership'
                          : 'Single membership'
                        : latestMembership?.membership_type
                          ? 'Previous-season membership'
                          : 'No membership assigned'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {familyLink
                  ? familyPaidThisSeason
                    ? 'Family membership paid'
                    : 'Family membership unpaid for the current season'
                  : individualMembershipCurrentSeason
                    ? latestMembership?.payment_status === 'paid'
                      ? 'Membership paid'
                      : 'Payment status: unpaid'
                    : 'No payment recorded for the current season'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Season fee:{' '}
                {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(
                  ((['confirmed', 'removed_next_season'].includes(familyLink?.status || '') &&
                    familyInfo?.season_year === targetSeasonYear) ||
                  (individualMembershipCurrentSeason &&
                    String(latestMembership?.membership_type || '')
                      .toLowerCase()
                      .includes('family'))
                    ? (membershipSettings?.family_price_cents ?? 22000)
                    : (membershipSettings?.single_price_cents ?? 15000)) / 100,
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Paid date:{' '}
                {(
                  familyLink
                    ? familyPaidThisSeason
                      ? familyInfo?.paid_at || null
                      : null
                    : individualMembershipCurrentSeason
                      ? latestPaymentForMembership?.succeeded_at ||
                        latestPaymentForMembership?.created_at ||
                        null
                      : null
                )
                  ? new Date(
                      (familyLink
                        ? familyPaidThisSeason
                          ? familyInfo?.paid_at
                          : null
                        : individualMembershipCurrentSeason
                          ? latestPaymentForMembership?.succeeded_at ||
                            latestPaymentForMembership?.created_at
                          : null) as string,
                    ).toLocaleDateString('en-CA', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'No payment recorded'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Season:{' '}
                {membershipSettings
                  ? `${new Date(2024, membershipSettings.season_start_month - 1).toLocaleString('en-CA', { month: 'long' })} ${membershipSettings.season_start_day} – ${new Date(2024, membershipSettings.season_end_month - 1).toLocaleString('en-CA', { month: 'long' })} ${membershipSettings.season_end_day}`
                  : 'April 1 – September 30'}
              </p>
              {familyNames.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium">Family members</p>
                  <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                    {familyNames.map((name, i) => (
                      <li key={`${name}-${i}`}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Button asChild variant="outline" className="mt-4">
                <Link href="/member/membership">Manage membership</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>My activity overview</CardTitle>
              <CardDescription>Your club event participation.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Past events attended', value: past.length },
                  { label: 'Upcoming registrations', value: upcoming.length },
                  { label: 'Waitlisted', value: waitlisted.length },
                  { label: 'Cancelled registrations', value: cancelled.length },
                ].map((x) => (
                  <div key={x.label} className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">{x.label}</p>
                    <p className="mt-1 text-2xl font-semibold">{x.value}</p>
                  </div>
                ))}
              </div>
              <Button asChild variant="outline" className="mt-4">
                <Link href="/member/results">View results</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>My event registrations</CardTitle>
              <CardDescription>Upcoming sessions and registration status.</CardDescription>
            </CardHeader>
            <CardContent>
              {registrations?.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {registrations
                    .filter((r) => {
                      const ev = Array.isArray(r.event) ? r.event[0] : r.event;
                      return (
                        ev?.starts_at &&
                        new Date(ev.starts_at).getTime() >= Date.now() &&
                        r.status !== 'cancelled'
                      );
                    })
                    .slice(0, 8)
                    .map((r) => {
                      const ev = Array.isArray(r.event) ? r.event[0] : r.event;
                      return (
                        <Link
                          key={r.id}
                          href={`/events/${ev?.slug ?? ev?.id ?? r.event_id}`}
                          className="block rounded-lg border border-border p-4 transition-colors hover:bg-accent/50"
                        >
                          <span className="font-medium hover:underline">
                            {ev?.title ?? 'Event'}
                          </span>
                          <p className="mt-1 text-sm capitalize text-muted-foreground">
                            {ev?.starts_at ? new Date(ev.starts_at).toLocaleString('en-CA') : ''} ·{' '}
                            {r.status}
                            {r.status === 'waitlisted' ? ' (waitlist)' : ''}
                          </p>
                        </Link>
                      );
                    })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You have no event registrations yet.
                </p>
              )}
              <Button asChild variant="outline" className="mt-4">
                <Link href="/events">Browse events</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
        <section className="mt-8">
          <details className="group rounded-lg border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
              Recent Event Activity
              <span
                className="text-sm text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              >
                ⌄
              </span>
            </summary>
            {activityRows.filter(
              (r) => r.event?.starts_at && new Date(r.event.starts_at).getTime() < Date.now(),
            ).length ? (
              <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-2">
                {activityRows
                  .filter(
                    (r) => r.event?.starts_at && new Date(r.event.starts_at).getTime() < Date.now(),
                  )
                  .slice(0, 10)
                  .map((r) => (
                    <Link
                      key={r.id}
                      href={`/events/${r.event?.slug ?? r.event?.id ?? r.event_id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                    >
                      <div>
                        <span className="font-medium hover:underline">
                          {r.event?.title || 'Event'}
                        </span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.event?.starts_at
                            ? new Date(r.event.starts_at).toLocaleDateString('en-CA')
                            : 'Date unavailable'}
                        </p>
                      </div>
                      <span className="text-sm capitalize text-muted-foreground">{r.status}</span>
                    </Link>
                  ))}
              </div>
            ) : (
              <p className="border-t border-border p-4 text-sm text-muted-foreground">
                No event registration history yet.
              </p>
            )}
          </details>
        </section>
      </div>
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socials} />
    </main>
  );
}
