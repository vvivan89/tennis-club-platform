'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, CreditCard, Users } from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { MemberNav } from '@/components/member-nav';
import { SearchableMemberSelect } from '@/components/searchable-member-select';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  application_status?: string;
  tennis_skill_level?: number | null;
};
type FamilyMember = {
  id: string;
  user_id: string;
  status: string;
  invited_by?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
  profiles?: { id?: string; full_name: string | null; email: string | null } | null;
};
type Family = {
  id: string;
  season_year: number;
  paid_at: string | null;
  paid_by?: string | null;
  payment_id: string | null;
};
type FamilyEntry = {
  membership: {
    id: string;
    family_id: string;
    user_id: string;
    invited_by?: string | null;
    status: string;
    joined_at: string | null;
    created_at: string;
  };
  family: Family;
  members: FamilyMember[];
};
type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  tennis_skill_level: number | null;
  date_of_birth?: string | null;
  available?: boolean;
  unavailableReason?: string;
};
type MembershipSettings = {
  single_price_cents: number;
  family_price_cents: number;
  family_max_adults: number;
  family_max_children: number;
  season_start_month: number;
  season_start_day: number;
  season_end_month: number;
  season_end_day: number;
};
type Membership = {
  id: string;
  user_id: string;
  membership_type: string;
  status: string;
  payment_status: string;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
};
type Payment = {
  id: string;
  membership_id: string;
  amount_cents: number;
  status: string;
  provider: string | null;
  paid_at: string | null;
  created_at: string;
  notes: string | null;
};
type State = {
  families: FamilyEntry[];
  people: Person[];
  settings: MembershipSettings | null;
  memberships: Membership[];
  payments: Payment[];
};
const emptyState: State = {
  families: [],
  people: [],
  settings: null,
  memberships: [],
  payments: [],
};
const money = (c: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((c || 0) / 100);
const date = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
export default function MembershipPortal() {
  const [state, setState] = useState<State>(emptyState);
  const [me, setMe] = useState<Profile | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [club, setClub] = useState<{
    club_name: string;
    short_name: string;
    social_links: { url: string }[];
  }>({ club_name: 'Port Coquitlam Tennis Club', short_name: 'PCTC', social_links: [] });
  const load = useCallback(async () => {
    setLoading(true);
    const db = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    const [{ data: profile }, { data: cs }] = await Promise.all([
      user
        ? db
            .from('profiles')
            .select('id,full_name,email,application_status')
            .eq('id', user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from('club_settings')
        .select('club_name,short_name,social_links')
        .eq('id', 1)
        .maybeSingle(),
    ]);
    setMe(profile);
    if (cs) setClub(cs);
    if (user) {
      const r = await fetch('/api/membership/family');
      const j = await r.json();
      if (r.ok) setState({ ...emptyState, ...j });
      else {
        console.error('[Member membership] Load failed', { status: r.status, result: j });
        setMessage('Unable to load membership information. Please try again.');
      }
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(
    action: 'invite' | 'confirm' | 'remove',
    extra: { userId?: string; invitationId?: string } = {},
  ) {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/membership/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await r.json();
      if (!r.ok) {
        console.error('[Member membership] Family membership update failed', {
          status: r.status,
          result: j,
        });
        throw new Error('family-update-failed');
      }
      setMessage(
        j.effectiveNextSeason ? 'Your family removal is scheduled for the next season.' : 'Saved.',
      );
      setSelected('');
      await load();
    } catch (e) {
      console.error('[Member membership] Family membership request failed', e);
      setMessage('Could not update family membership. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  const active = [...state.families]
    .filter(
      (x) =>
        x.membership.user_id === me?.id &&
        ['confirmed', 'pending', 'removed_next_season'].includes(x.membership.status),
    )
    .sort(
      (a, b) =>
        new Date(b.membership.joined_at || b.membership.created_at || 0).getTime() -
        new Date(a.membership.joined_at || a.membership.created_at || 0).getTime(),
    )[0];
  const currentFamily = active?.family;
  const currentMembers = active?.members ?? [];
  const incoming = state.families.filter(
    (x) => x.membership.user_id === me?.id && x.membership.status === 'pending',
  );
  const latest = state.memberships?.[0];
  const latestPayment = (state.payments ?? []).find(
    (p) =>
      p.membership_id === latest?.id && (p.status === 'paid' || p.status === 'recorded_manually'),
  );
  const familyPaid = Boolean(currentFamily?.paid_at || currentFamily?.payment_id);
  const familyType =
    active?.membership.status === 'confirmed'
      ? 'Family membership'
      : active?.membership.status === 'pending'
        ? 'Family invitation pending'
        : active?.membership.status === 'removed_next_season'
          ? 'Family membership · leaving next season'
          : null;
  const type =
    familyType ||
    (latest?.membership_type
      ? String(latest.membership_type)
          .replaceAll('_', ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : 'No membership record');
  const isActiveFamily =
    active?.membership.status === 'confirmed' ||
    active?.membership.status === 'removed_next_season';
  const paid = isActiveFamily
    ? familyPaid
    : Boolean(latest && (latest.payment_status === 'paid' || latestPayment));
  const paidAt = isActiveFamily
    ? (currentFamily?.paid_at ?? null)
    : latestPayment?.paid_at || latestPayment?.created_at || null;
  const familyPlan = Boolean(
    familyType ||
    String(latest?.membership_type || '')
      .toLowerCase()
      .includes('family'),
  );
  const currentPrice = familyPlan
    ? (state.settings?.family_price_cents ?? 22000)
    : (state.settings?.single_price_cents ?? 15000);
  const ordinal = (day: number) => {
    const mod100 = day % 100;
    const suffix =
      mod100 >= 11 && mod100 <= 13
        ? 'th'
        : day % 10 === 1
          ? 'st'
          : day % 10 === 2
            ? 'nd'
            : day % 10 === 3
              ? 'rd'
              : 'th';
    return `${day}${suffix}`;
  };
  const seasonLabel = state.settings
    ? `${new Date(2024, state.settings.season_start_month - 1, 1).toLocaleString('en-CA', { month: 'long' })} ${ordinal(state.settings.season_start_day)} - ${new Date(2024, state.settings.season_end_month - 1, 1).toLocaleString('en-CA', { month: 'long' })} ${ordinal(state.settings.season_end_day)}`
    : 'April 1st - September 30th';
  const eligiblePeople = useMemo(
    () =>
      state.people
        .filter((p) => p.id !== me?.id)
        .sort((a, b) =>
          String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')),
        ),
    [state.people, me?.id],
  );
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        clubName={club.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club.short_name || 'PCTC'}
      />
      <MemberNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Member portal</p>
        <h1 className="section-title">Membership</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your membership, payments, and family plan for the club season ({seasonLabel}).
        </p>
        {message && (
          <p role="status" className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {message}
          </p>
        )}
        {loading ? (
          <TennisLoader label="Loading membership details" />
        ) : (
          <div className="mt-7 space-y-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="rounded-xl border border-border p-5 lg:col-span-2">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">Your membership</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Current membership type and payment status.
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${paid ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}
                  >
                    {paid ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Clock3 className="h-3.5 w-3.5" />
                    )}
                    {paid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Membership type
                    </p>
                    <p className="mt-1 text-xl font-semibold">{type}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Season fee
                    </p>
                    <p className="mt-1 text-xl font-semibold">
                      {currentPrice == null ? '—' : money(currentPrice)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Paid date
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {paid ? date(paidAt) : 'No payment recorded'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Membership period
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {latest?.starts_on || latest?.ends_on
                        ? `${date(latest.starts_on)} – ${date(latest.ends_on)}`
                        : currentFamily
                          ? `Season ${currentFamily.season_year}`
                          : 'No dates recorded'}
                    </p>
                  </div>
                </div>
                {active?.membership.status === 'removed_next_season' && (
                  <p className="mt-4 rounded-md bg-muted p-3 text-sm">
                    Your family membership remains in effect for the current season and is scheduled
                    to end next season.
                  </p>
                )}
              </section>
              <section className="rounded-xl border border-border p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Season details</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Plan prices and limits.</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Single membership</span>
                    <strong>{money(state.settings?.single_price_cents ?? 15000)}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Family membership</span>
                    <strong>{money(state.settings?.family_price_cents ?? 22000)}</strong>
                  </div>
                  <div className="border-t border-border pt-3 text-muted-foreground">
                    Family limit: {state.settings?.family_max_adults ?? 2} adults and{' '}
                    {state.settings?.family_max_children ?? 4} children.
                  </div>
                </div>
              </section>
            </div>
            <section className="rounded-xl border border-border p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Family membership</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                      Manage your family group or invite another approved member. Invited members
                      must accept before they are added to the group.
                    </p>
                  </div>
                </div>
                {currentFamily && (
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs capitalize">
                    {active?.membership.status?.replaceAll('_', ' ')}
                  </span>
                )}
              </div>
              {currentFamily ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {currentMembers.map((m) => (
                      <div key={m.id} className="rounded-lg bg-muted/40 p-3">
                        <p className="font-medium">
                          {m.profiles?.full_name || m.profiles?.email || 'Member'}
                          {m.user_id === me?.id ? ' (you)' : ''}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {m.profiles?.email || 'No email'} · {m.status.replaceAll('_', ' ')}
                        </p>
                      </div>
                    ))}
                  </div>
                  {active?.membership.status === 'confirmed' && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button variant="outline" disabled={busy} onClick={() => void act('remove')}>
                        Leave family
                      </Button>
                      {familyPaid && (
                        <p className="text-xs text-muted-foreground">
                          Since this season is paid, leaving takes effect next season.
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-5 max-w-xl">
                  <label className="mb-2 block text-sm font-medium">Member to invite</label>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Browse approved members by name and skill level. Members already in a family or
                    with a pending invitation remain visible but cannot be selected.
                  </p>
                  <SearchableMemberSelect
                    options={eligiblePeople}
                    value={selected}
                    onChange={setSelected}
                    placeholder="Search by player name…"
                  />
                  <Button
                    className="mt-3"
                    disabled={busy || !selected}
                    onClick={() => void act('invite', { userId: selected })}
                  >
                    {busy ? <TennisLoader compact label="Sending" /> : 'Send family invitation'}
                  </Button>
                </div>
              )}
              {incoming.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <h3 className="font-semibold">Pending invitations</h3>
                  <div className="mt-3 space-y-2">
                    {incoming.map((x) => (
                      <div
                        key={x.membership.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            Invitation to join family membership
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Season {x.family.season_year}
                          </p>
                        </div>
                        <Button
                          disabled={busy}
                          onClick={() => void act('confirm', { invitationId: x.membership.id })}
                        >
                          Accept invitation
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            {state.payments?.length > 0 && (
              <section className="rounded-xl border border-border p-5">
                <h2 className="text-lg font-semibold">Payment history</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 font-medium">Amount</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.payments.map((p) => (
                        <tr key={p.id} className="border-t border-border">
                          <td className="whitespace-nowrap px-3 py-2">
                            {date(p.paid_at || p.created_at)}
                          </td>
                          <td className="px-3 py-2">{p.notes || 'Membership payment'}</td>
                          <td className="px-3 py-2">{money(p.amount_cents)}</td>
                          <td className="px-3 py-2 capitalize">
                            {String(p.status).replaceAll('_', ' ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <SiteFooter
        clubName={club.club_name}
        shortName={club.short_name}
        socialLinks={Array.isArray(club.social_links) ? club.social_links : []}
      />
    </main>
  );
}
