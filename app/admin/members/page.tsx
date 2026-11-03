import { SiteFooter } from '@/components/site-footer';
import { AdminSectionTabs } from '@/components/admin-section-tabs';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { AdminNav } from '@/components/admin-nav';
import { MembersTable, type MemberRow } from '@/components/admin-members-table';
import type { SuspensionRecord } from '@/components/member-edit-modal';
import { InviteMemberForm } from '@/components/invite-member-form';
import { MembershipTypesAdmin } from '@/components/membership-types-admin';
import { AdminApplications } from '@/components/admin-applications';
type MembershipRow = {
  id: string;
  user_id: string;
  membership_type: string;
  status: string;
  payment_status: string | null;
};
type FamilyMemberRow = {
  family_id: string;
  user_id: string;
  status: string;
  membership_families?:
    | { paid_at: string | null; season_year: number }
    | { paid_at: string | null; season_year: number }[]
    | null;
};
export default async function MembersAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = params?.tab ?? 'members';
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/admin/members');
  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') redirect('/member/dashboard');
  if (tab === 'membership-types') {
    const { data } = await db
      .from('membership_plan_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    const settings = data ?? {
      single_price_cents: 0,
      family_price_cents: 0,
      family_max_adults: 2,
      family_max_children: 4,
      season_start_month: 4,
      season_start_day: 1,
      season_end_month: 9,
      season_end_day: 30,
    };
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AdminNav />
        <div className="page-container py-10">
          <AdminSectionTabs section="membership" />
          <p className="eyebrow">Club administration</p>
          <h1 className="section-title">Membership types</h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            Configure membership prices, family limits, and the shared membership season. Prices are
            full-season prices in CAD.
          </p>
          <MembershipTypesAdmin
            initial={{
              single_price_cad: settings.single_price_cents / 100,
              family_price_cad: settings.family_price_cents / 100,
              family_max_adults: settings.family_max_adults,
              family_max_children: settings.family_max_children,
              season_start_month: settings.season_start_month,
              season_end_month: settings.season_end_month,
            }}
          />
        </div>
      </main>
    );
  }
  if (tab === 'applications') {
    const { data, error } = await db
      .from('profiles')
      .select('id,full_name,email,phone,tennis_skill_level,application_comment,created_at')
      .eq('application_status', 'pending')
      .eq('account_kind', 'member')
      .order('created_at');
    return (
      <main className="flex min-h-screen flex-col bg-background text-foreground">
        <AdminNav />
        <div className="page-container flex-1 py-10">
          <AdminSectionTabs section="membership" />
          <p className="eyebrow">Club administration</p>
          <h1 className="section-title">Membership applications</h1>
          <p className="mt-3 mb-7 text-sm text-muted-foreground">
            New accounts remain unapproved until an administrator accepts their application.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : (
            <AdminApplications applications={data ?? []} />
          )}
        </div>
        <SiteFooter />
      </main>
    );
  }
  const [
    profilesResult,
    membershipsResult,
    paymentsResult,
    registrationsResult,
    notesResult,
    suspensionsResult,
    familyResult,
  ] = await Promise.all([
    db
      .from('profiles')
      .select('id,full_name,email,phone,tennis_skill_level,role,created_at')
      .eq('application_status', 'approved')
      .eq('account_kind', 'member')
      .order('full_name'),
    db
      .from('memberships')
      .select('id,user_id,membership_type,status,payment_status,created_at')
      .order('created_at', { ascending: false }),
    db
      .from('payments')
      .select('business_record_id,status,created_at')
      .eq('purpose', 'membership')
      .order('created_at', { ascending: false }),
    db
      .from('registrations')
      .select('user_id,status,events!inner(starts_at,status)')
      .eq('status', 'confirmed')
      .eq('events.status', 'published'),
    db.from('member_admin_notes').select('user_id,comment'),
    db
      .from('member_suspensions')
      .select('id,user_id,starts_on,ends_on,reason,created_at,cancelled_at')
      .is('cancelled_at', null)
      .order('starts_on', { ascending: false }),
    db
      .from('membership_family_members')
      .select('family_id,user_id,status,membership_families(paid_at,season_year)')
      .in('status', ['confirmed', 'removed_next_season']),
  ]);
  const { data: profiles, error } = profilesResult;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const membershipByUser = new Map<string, MembershipRow>();
  for (const m of membershipsResult.data ?? [])
    if (!membershipByUser.has(m.user_id)) membershipByUser.set(m.user_id, m);
  const paymentByMembership = new Map<string, string>();
  for (const p of paymentsResult.data ?? [])
    if (p.business_record_id) {
      if (['succeeded', 'partially_refunded', 'refunded'].includes(p.status))
        paymentByMembership.set(p.business_record_id, 'paid');
      else if (!paymentByMembership.has(p.business_record_id))
        paymentByMembership.set(p.business_record_id, 'unpaid');
    }
  const familyByUser = new Map<string, { familyId: string; paid: boolean; names: string[] }>();
  const familyGroups = new Map<string, FamilyMemberRow[]>();
  for (const row of familyResult.data ?? []) {
    if (!familyGroups.has(row.family_id)) familyGroups.set(row.family_id, []);
    familyGroups.get(row.family_id)!.push(row);
  }
  for (const [familyId, rows] of familyGroups) {
    const relation = (rows[0] as FamilyMemberRow).membership_families;
    const family = Array.isArray(relation) ? relation[0] : relation;
    for (const row of rows) {
      const names = rows
        .filter((other) => other.user_id !== row.user_id)
        .map(
          (other) =>
            profileById.get(other.user_id)?.full_name ||
            profileById.get(other.user_id)?.email ||
            'Member',
        );
      familyByUser.set(row.user_id, { familyId, paid: Boolean(family?.paid_at), names });
    }
  }
  const lastPlayed = new Map<string, string>();
  for (const registration of registrationsResult.data ?? []) {
    const event = Array.isArray(registration.events) ? registration.events[0] : registration.events;
    if (!event?.starts_at || new Date(event.starts_at).getTime() > Date.now()) continue;
    const previous = lastPlayed.get(registration.user_id);
    if (!previous || new Date(event.starts_at).getTime() > new Date(previous).getTime())
      lastPlayed.set(registration.user_id, event.starts_at);
  }
  const notes = new Map((notesResult.data ?? []).map((n) => [n.user_id, n.comment]));
  const suspensionMap = new Map<string, SuspensionRecord[]>();
  for (const item of suspensionsResult.data ?? []) {
    const existing = suspensionMap.get(item.user_id) ?? [];
    existing.push({
      id: item.id,
      starts_on: item.starts_on,
      ends_on: item.ends_on,
      reason: item.reason,
      created_at: item.created_at,
      cancelled_at: item.cancelled_at,
    });
    suspensionMap.set(item.user_id, existing);
  }
  const rows: MemberRow[] = (profiles ?? []).map((m) => {
    const membership = membershipByUser.get(m.id);
    const family = familyByUser.get(m.id);
    const membershipType = family
      ? 'family'
      : membership
        ? String(membership.membership_type || 'single')
            .toLowerCase()
            .includes('family')
          ? 'family'
          : 'single'
        : 'none';
    const paymentStatus = family
      ? family.paid
        ? 'paid'
        : 'unpaid'
      : membership
        ? (paymentByMembership.get(membership.id) ?? membership.payment_status ?? 'unpaid')
        : 'unpaid';
    return {
      ...m,
      payment_status: paymentStatus,
      membership_type: membershipType,
      family_members: family?.names ?? [],
      last_played: lastPlayed.get(m.id) ?? null,
      admin_comment: notes.get(m.id) ?? '',
      suspensions: suspensionMap.get(m.id) ?? [],
    };
  });
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <AdminSectionTabs section="membership" />
        <p className="eyebrow">Club administration</p>
        <h1 className="section-title">Members</h1>
        <div className="my-7">
          <InviteMemberForm />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <MembersTable initialMembers={rows} />
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
