import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { escapeHtml as esc, sendResendEmail } from '@/lib/resend';
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
  let sent = 0,
    failed = 0;
  for (const ev of events ?? []) {
    const { data: profiles } = await db
      .from('profiles')
      .select('id,email,full_name')
      .eq('application_status', 'approved')
      .eq('email_registration_reminders', true);
    for (const p of profiles ?? []) {
      const { data: reg } = await db
        .from('registrations')
        .select('id')
        .eq('event_id', ev.id)
        .eq('user_id', p.id)
        .in('status', ['confirmed', 'waitlisted'])
        .maybeSingle();
      if (reg) continue;
      const { error: logErr } = await db
        .from('event_email_log')
        .insert({ event_id: ev.id, user_id: p.id, email_type: 'registration_reminder' });
      if (logErr) continue;
      const eventUrl = new URL(`/events/${ev.slug || ev.id}`, request.url).toString();
      const response = await sendResendEmail({
        to: p.email,
        subject: `Registration is open: ${ev.title}`,
        html: `<p>Hello ${esc(p.full_name || 'member')},</p><p>Registration is now open for <strong>${esc(ev.title)}</strong>.</p><p>${esc(new Date(ev.starts_at).toLocaleString('en-CA'))} · ${esc(ev.location || '')}</p><p><a href="${esc(eventUrl)}">View event and register</a></p>`,
      });
      if (response.ok) sent++;
      else {
        failed++;
        await db
          .from('event_email_log')
          .delete()
          .eq('event_id', ev.id)
          .eq('user_id', p.id)
          .eq('email_type', 'registration_reminder');
      }
    }
  }
  return NextResponse.json({ success: true, sent, failed, events: events?.length ?? 0 });
}
