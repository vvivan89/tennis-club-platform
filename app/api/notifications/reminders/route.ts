import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-helpers';
import { mapInChunks } from '@/lib/async';
import { fetchAllRows } from '@/lib/fetch-all-rows';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { escapeHtml as esc, sendResendEmail } from '@/lib/resend';
import { getSiteOrigin } from '@/lib/site-url';

const SEND_CONCURRENCY = 10;
const EMAIL_TYPE = 'registration_reminder';

export async function GET(request: Request) {
  if (!isCronAuthorized(request))
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)
    return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 });
  const db = createServiceRoleClient(url, key);
  const now = new Date(),
    from = new Date(now.getTime() - 11 * 60 * 1000),
    to = new Date(now.getTime() - 9 * 60 * 1000);
  const { data: events, error } = await db
    .from('events')
    .select('id,slug,title,starts_at,location,registration_opens_at')
    .eq('status', 'published')
    .gte('registration_opens_at', from.toISOString())
    .lte('registration_opens_at', to.toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events?.length) return NextResponse.json({ success: true, sent: 0, failed: 0, events: 0 });

  const members = await fetchAllRows<{
    id: string;
    email: string | null;
    full_name: string | null;
  }>((rangeFrom, rangeTo) =>
    db
      .from('profiles')
      .select('id,email,full_name')
      .eq('application_status', 'approved')
      .eq('email_registration_reminders', true)
      .order('id')
      .range(rangeFrom, rangeTo),
  );
  if (members.error)
    return NextResponse.json({ error: 'Could not load recipients.' }, { status: 500 });
  const recipients = members.rows.filter((m) => m.email);

  let sent = 0,
    failed = 0;
  for (const ev of events) {
    const [registered, logged] = await Promise.all([
      fetchAllRows<{ user_id: string }>((rangeFrom, rangeTo) =>
        db
          .from('registrations')
          .select('user_id')
          .eq('event_id', ev.id)
          .in('status', ['confirmed', 'waitlisted'])
          .order('id')
          .range(rangeFrom, rangeTo),
      ),
      fetchAllRows<{ user_id: string }>((rangeFrom, rangeTo) =>
        db
          .from('event_email_log')
          .select('user_id')
          .eq('event_id', ev.id)
          .eq('email_type', EMAIL_TYPE)
          .order('id')
          .range(rangeFrom, rangeTo),
      ),
    ]);
    // Without both lists we could mail people who are registered or already reminded.
    if (registered.error || logged.error) {
      console.error('[Reminders] Could not load registrations or reminder log', { eventId: ev.id });
      continue;
    }
    const skip = new Set([...registered.rows, ...logged.rows].map((r) => r.user_id));
    const eventUrl = new URL(`/events/${ev.slug || ev.id}`, getSiteOrigin(request)).toString();
    const due = recipients.filter((p) => !skip.has(p.id));

    const results = await mapInChunks(due, SEND_CONCURRENCY, async (p) => {
      try {
        // The key makes a retry after a crash (or an overlapping run) a no-op at the provider.
        const response = await sendResendEmail({
          to: p.email!,
          subject: `Registration is open: ${ev.title}`,
          html: `<p>Hello ${esc(p.full_name || 'member')},</p><p>Registration is now open for <strong>${esc(ev.title)}</strong>.</p><p>${esc(new Date(ev.starts_at).toLocaleString('en-CA'))} · ${esc(ev.location || '')}</p><p><a href="${esc(eventUrl)}">View event and register</a></p>`,
          idempotencyKey: `registration-reminder:${ev.id}:${p.id}`,
        });
        if (!response.ok) return false;
      } catch {
        return false;
      }
      const { error: logError } = await db
        .from('event_email_log')
        .insert({ event_id: ev.id, user_id: p.id, email_type: EMAIL_TYPE });
      // 23505 means a parallel run already recorded it.
      if (logError && logError.code !== '23505')
        console.error('[Reminders] Could not record sent reminder', {
          eventId: ev.id,
          message: logError.message,
        });
      return true;
    });
    for (const ok of results) {
      if (ok) sent++;
      else failed++;
    }
  }
  return NextResponse.json({ success: true, sent, failed, events: events.length });
}
