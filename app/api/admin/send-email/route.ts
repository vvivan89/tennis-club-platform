import { NextResponse } from 'next/server';
import { checkAdminRole, getConfiguredServiceClient, getSignedInUser } from '@/lib/api-helpers';
import { createHash } from 'node:crypto';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  isEmailGroup,
  loadEmailRecipients,
  MAX_EMAIL_HTML_LENGTH,
  MAX_EMAIL_RECIPIENTS,
} from '@/lib/email-audience';
import { escapeHtml, sendResendEmail } from '@/lib/resend';
import { sanitizeHtml } from '@/lib/sanitize-html';
const SEND_CONCURRENCY = 10;

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
    const limited = await enforceRateLimit(request, {
      name: 'send-email',
      limit: 30,
      windowSeconds: 3600,
      userId: user.id,
    });
    if (limited) return limited;
    const body = await request.json();
    const group = String(body.group ?? '');
    if (!isEmailGroup(group))
      return NextResponse.json({ error: 'Choose a valid recipient group.' }, { status: 400 });
    const recipients = await loadEmailRecipients(db, group);
    const deliverable = recipients.filter((r) => r.email);
    if (body.preview === true)
      return NextResponse.json({ recipientCount: deliverable.length, group });
    const subject = String(body.subject ?? '')
      .trim()
      .slice(0, 180);
    const rawHtml = String(body.html ?? '');
    if (rawHtml.length > MAX_EMAIL_HTML_LENGTH)
      return NextResponse.json({ error: 'The email content is too long.' }, { status: 413 });
    const html = sanitizeHtml(rawHtml);
    if (!subject || !html.replace(/<[^>]+>/g, '').trim())
      return NextResponse.json(
        { error: 'Subject and email content are required.' },
        { status: 400 },
      );
    if (recipients.length > MAX_EMAIL_RECIPIENTS)
      return NextResponse.json(
        {
          error: `This group has ${recipients.length} recipients; at most ${MAX_EMAIL_RECIPIENTS} can be emailed at once. Choose a smaller group.`,
        },
        { status: 422 },
      );
    // Identical announcements to the same person within 24h are dropped by Resend (guards double-clicks).
    const contentKey = createHash('sha256')
      .update(`${user.id}\n${group}\n${subject}\n${html}`)
      .digest('hex')
      .slice(0, 32);
    let sent = 0,
      failed = recipients.length - deliverable.length;
    for (let i = 0; i < deliverable.length; i += SEND_CONCURRENCY) {
      const results = await Promise.all(
        deliverable.slice(i, i + SEND_CONCURRENCY).map(async (p) => {
          try {
            const res = await sendResendEmail({
              to: p.email!,
              subject,
              html: `<p>Hello ${escapeHtml(String(p.full_name || 'member'))},</p>${html}<p>Port Coquitlam Tennis Club</p>`,
              idempotencyKey: `announcement:${contentKey}:${p.id}`,
            });
            return res.ok;
          } catch {
            return false;
          }
        }),
      );
      for (const ok of results) {
        if (ok) sent++;
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
