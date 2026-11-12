import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { escapeHtml as esc, sendResendEmail } from '@/lib/resend';
import { getSiteOrigin } from '@/lib/site-url';
import { fetchAllRows } from '@/lib/fetch-all-rows';
const SEND_CONCURRENCY = 10;
const COVERED_FAMILY_STATUSES = ['confirmed', 'removed_next_season'];

type FamilyInfo = { paid_at: string | null; season_year: number };
type FamilyRow = {
  user_id: string;
  status: string;
  membership_families: FamilyInfo | FamilyInfo[] | null;
};

export async function GET(request: Request) {
  if (!isCronAuthorized(request))
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.RESEND_API_KEY ||
    !process.env.RESEND_FROM_EMAIL
  )
    return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 });
  const db = createServiceRoleClient();
  const { data: cfg } = await db
    .from('membership_plan_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  const { data: clubSettings } = await db
    .from('club_settings')
    .select('short_name')
    .eq('id', 1)
    .maybeSingle();
  const shortName = clubSettings?.short_name || 'Tennis Club';
  if (!cfg)
    return NextResponse.json({
      success: true,
      sent: 0,
      reason: 'Membership settings not configured',
    });
  const today = new Date();
  const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  const candidates = [
    today.getUTCFullYear() - 1,
    today.getUTCFullYear(),
    today.getUTCFullYear() + 1,
  ].map((y) => ({
    year: y,
    start: date(y, cfg.season_start_month, cfg.season_start_day),
    end: date(y, cfg.season_end_month, cfg.season_end_day),
  }));
  const season = candidates.find((x) => {
    const days = Math.round((x.start.getTime() - today.getTime()) / 86400000);
    const after = Math.round((today.getTime() - x.start.getTime()) / 86400000);
    return days === 7 || after === 7;
  });
  if (!season) return NextResponse.json({ success: true, sent: 0 });
  const daysTo = Math.round((season.start.getTime() - today.getTime()) / 86400000);
  const type = daysTo === 7 ? 'before' : 'after';
  const year = season.year;
  const endDate = season.end.toISOString().slice(0, 10);
  const [profiles, logs, familyRows, memberships, payments] = await Promise.all([
    fetchAllRows<{ id: string; email: string | null; full_name: string | null }>((from, to) =>
      db
        .from('profiles')
        .select('id,email,full_name')
        .eq('application_status', 'approved')
        .order('id')
        .range(from, to),
    ),
    fetchAllRows<{ user_id: string }>((from, to) =>
      db
        .from('membership_reminder_log')
        .select('user_id')
        .eq('season_year', year)
        .eq('reminder_type', type)
        .order('id')
        .range(from, to),
    ),
    fetchAllRows<FamilyRow>((from, to) =>
      db
        .from('membership_family_members')
        .select('user_id,status,membership_families(paid_at,season_year)')
        .in('status', COVERED_FAMILY_STATUSES)
        .order('id')
        .range(from, to),
    ),
    fetchAllRows<{
      id: string;
      user_id: string;
      ends_on: string | null;
      payment_status: string | null;
    }>((from, to) =>
      db
        .from('memberships')
        .select('id,user_id,ends_on,status,payment_status')
        .in('status', ['active', 'expired'])
        .order('id')
        .range(from, to),
    ),
    fetchAllRows<{ business_record_id: string }>((from, to) =>
      db
        .from('payments')
        .select('business_record_id')
        .eq('purpose', 'membership')
        .eq('status', 'succeeded')
        .order('id')
        .range(from, to),
    ),
  ]);
  const failedLookup = [profiles, logs, familyRows, memberships, payments].find((r) => r.error);
  // Without complete data we can't tell who has paid, so send nothing.
  if (failedLookup)
    return NextResponse.json({ error: 'Could not load membership data.' }, { status: 500 });

  const alreadyReminded = new Set(logs.rows.map((r) => r.user_id));
  const coveredByFamily = new Set(
    familyRows.rows
      .filter((row) => {
        const family = Array.isArray(row.membership_families)
          ? row.membership_families[0]
          : row.membership_families;
        return (
          COVERED_FAMILY_STATUSES.includes(row.status) &&
          !!family?.paid_at &&
          family.season_year === year
        );
      })
      .map((row) => row.user_id),
  );
  const paidRecordIds = new Set(payments.rows.map((r) => r.business_record_id));
  const paidMembers = new Set(
    memberships.rows
      .filter(
        (m) => m.payment_status === 'paid' || (m.ends_on === endDate && paidRecordIds.has(m.id)),
      )
      .map((m) => m.user_id),
  );
  const due = profiles.rows.filter(
    (p) => !alreadyReminded.has(p.id) && !coveredByFamily.has(p.id) && !paidMembers.has(p.id),
  );

  const subject =
    type === 'before'
      ? `${shortName} membership renewal is coming up`
      : `${shortName} membership fee reminder`;
  const text =
    type === 'before'
      ? `The ${shortName} membership season begins on ${season.start.toISOString().slice(0, 10)}. Please renew your membership before the season starts.`
      : `The ${shortName} membership season began on ${season.start.toISOString().slice(0, 10)} and we have not recorded a payment for you. Please renew your membership.`;
  const portalUrl = new URL('/member/membership', getSiteOrigin(request)).toString();

  async function remind(p: (typeof due)[number]): Promise<boolean | null> {
    if (!p.email) return false;
    // Claim first (unique per season/type/user) so overlapping or repeated runs can't double-send.
    const { error: claimError } = await db
      .from('membership_reminder_log')
      .insert({ season_year: year, reminder_type: type, user_id: p.id });
    if (claimError) return claimError.code === '23505' ? null : false;
    const release = () =>
      db
        .from('membership_reminder_log')
        .delete()
        .eq('season_year', year)
        .eq('reminder_type', type)
        .eq('user_id', p.id);
    try {
      const resp = await sendResendEmail({
        request,
        to: p.email,
        subject,
        html: `<p>Hello ${esc(p.full_name || 'member')},</p><p>${esc(text)}</p><p><a href="${portalUrl}">View your member portal</a></p>`,
        idempotencyKey: `membership-reminder:${year}:${type}:${p.id}`,
      });
      if (resp.ok) return true;
    } catch {
      // fall through to release the claim
    }
    await release();
    return false;
  }

  let sent = 0,
    failed = 0;
  for (let i = 0; i < due.length; i += SEND_CONCURRENCY) {
    const results = await Promise.all(due.slice(i, i + SEND_CONCURRENCY).map(remind));
    for (const result of results) {
      if (result === true) sent++;
      else if (result === false) failed++;
    }
  }
  return NextResponse.json({ success: true, season: year, type, sent, failed });
}
