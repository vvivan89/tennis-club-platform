import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { escapeHtml as esc, sendResendEmail } from '@/lib/resend';
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
  const { data: profiles } = await db
    .from('profiles')
    .select('id,email,full_name')
    .eq('application_status', 'approved');
  let sent = 0,
    failed = 0;
  for (const p of profiles ?? []) {
    const { data: logged } = await db
      .from('membership_reminder_log')
      .select('id')
      .eq('season_year', season.year)
      .eq('reminder_type', type)
      .eq('user_id', p.id)
      .maybeSingle();
    if (logged) continue;
    let paid = false;
    const { data: familyMember } = await db
      .from('membership_family_members')
      .select('family_id,membership_families(paid_at,season_year)')
      .eq('user_id', p.id)
      .in('status', ['confirmed', 'removed_next_season'])
      .maybeSingle();
    const familyRelation = (
      familyMember as {
        membership_families:
          | { paid_at: string | null; season_year: number }
          | { paid_at: string | null; season_year: number }[]
          | null;
      } | null
    )?.membership_families;
    const family = Array.isArray(familyRelation) ? familyRelation[0] : familyRelation;
    if (family?.paid_at && family.season_year === season.year) paid = true;
    const { data: memberships } = await db
      .from('memberships')
      .select('id,ends_on,status,payment_status')
      .eq('user_id', p.id)
      .in('status', ['active', 'expired']);
    for (const m of memberships ?? []) {
      if (m.payment_status === 'paid') {
        paid = true;
        break;
      }
      if (m.ends_on === season.end.toISOString().slice(0, 10)) {
        const { data: payment } = await db
          .from('payments')
          .select('id')
          .eq('purpose', 'membership')
          .eq('business_record_id', m.id)
          .eq('status', 'succeeded')
          .maybeSingle();
        if (payment) paid = true;
      }
    }
    if (paid) continue;
    const subject =
      type === 'before' ? 'PCTC membership renewal is coming up' : 'PCTC membership fee reminder';
    const text =
      type === 'before'
        ? `The PCTC membership season begins on ${season.start.toISOString().slice(0, 10)}. Please renew your membership before the season starts.`
        : `The PCTC membership season began on ${season.start.toISOString().slice(0, 10)} and we have not recorded a payment for you. Please renew your membership.`;
    const resp = await sendResendEmail({
      to: p.email,
      subject,
      html: `<p>Hello ${esc(p.full_name || 'member')},</p><p>${esc(text)}</p><p><a href="${new URL('/member/membership', request.url).toString()}">View your member portal</a></p>`,
    });
    if (resp.ok) {
      await db
        .from('membership_reminder_log')
        .insert({ season_year: season.year, reminder_type: type, user_id: p.id });
      sent++;
    } else failed++;
  }
  return NextResponse.json({ success: true, season: season.year, type, sent, failed });
}
