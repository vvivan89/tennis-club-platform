import { NextResponse } from 'next/server';
import { checkAdminRole, getConfiguredServiceClient, getSignedInUser } from '@/lib/api-helpers';
import { escapeHtml, sendResendEmail } from '@/lib/resend';
const clean = (s: string) =>
  s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
export async function POST(request: Request) {
  try {
    const { user, response: authError } = await getSignedInUser();
    if (authError) return authError;
    const { db, response: configError } = getConfiguredServiceClient(
      'Email service is not configured.',
    );
    if (configError || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)
      return (
        configError ??
        NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 })
      );
    const adminError = await checkAdminRole(db, user.id, { approved: true });
    if (adminError) return adminError;
    const body = await request.json();
    const subject = String(body.subject ?? '')
      .trim()
      .slice(0, 180);
    const html = clean(String(body.html ?? ''));
    const group = String(body.group ?? 'all');
    if (!subject || !html.replace(/<[^>]+>/g, '').trim())
      return NextResponse.json(
        { error: 'Subject and email content are required.' },
        { status: 400 },
      );
    let ids: string[] = [];
    if (group === 'newsletter') {
      const { data } = await db
        .from('profiles')
        .select('id')
        .eq('application_status', 'approved')
        .eq('email_newsletter', true);
      ids = (data ?? []).map((x) => x.id);
    } else if (group === 'admins' || group === 'organizers') {
      const { data } = await db
        .from('profiles')
        .select('id')
        .eq('role', group === 'admins' ? 'admin' : 'organizer')
        .eq('application_status', 'approved');
      ids = (data ?? []).map((x) => x.id);
    } else if (group === 'active_members') {
      const { data } = await db
        .from('memberships')
        .select('user_id')
        .eq('status', 'active')
        .or(`ends_on.is.null,ends_on.gte.${new Date().toISOString().slice(0, 10)}`);
      ids = [...new Set((data ?? []).map((x) => x.user_id))];
    } else {
      const { data } = await db.from('profiles').select('id');
      ids = (data ?? []).map((x) => x.id);
    }
    let sent = 0,
      failed = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const { data: profiles } = await db
        .from('profiles')
        .select('id,email,full_name')
        .in('id', batch);
      for (const p of profiles ?? []) {
        if (!p.email) {
          failed++;
          continue;
        }
        const greeting = `<p>Hello ${escapeHtml(String(p.full_name || 'member'))},</p>`;
        const res = await sendResendEmail({
          to: p.email,
          subject,
          html: `${greeting}${html}<p>Port Coquitlam Tennis Club</p>`,
        });
        if (res.ok) sent++;
        else failed++;
      }
    }
    const { error: historyError } = await db.from('email_announcement_history').insert({
      subject,
      body_html: html,
      recipient_group: group,
      sent_by: user.id,
      sent_count: sent,
      failed_count: failed,
    });
    if (historyError)
      console.error('Could not save email announcement history:', historyError.message);
    return NextResponse.json({ success: true, sent, failed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Email sending failed.' },
      { status: 500 },
    );
  }
}
