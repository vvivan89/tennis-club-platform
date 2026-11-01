import { NextResponse } from 'next/server';
import { getSignedInUser, getConfiguredServiceClient } from '@/lib/api-helpers';
import { escapeHtml as esc, sendResendEmail } from '@/lib/resend';

const templates: Record<string, { subject: string; intro: string }> = {
  registration_created: {
    subject: 'Your PCTC event registration',
    intro: 'Your registration has been recorded. Your current registration status is shown below.',
  },
  registration_cancelled: {
    subject: 'Your PCTC event registration was cancelled',
    intro: 'Your event registration has been cancelled.',
  },
  event_cancelled: {
    subject: 'PCTC event cancelled',
    intro: 'An event you registered for has been cancelled by the club.',
  },
  waitlist_confirmed: {
    subject: 'Your place in a PCTC event is confirmed',
    intro: 'A place has opened and you have been moved from the waitlist to confirmed.',
  },
  new_event_created: {
    subject: 'New PCTC event announced',
    intro: 'A new club event is available for registration.',
  },
};
export async function POST(request: Request) {
  try {
    const { user, response: authError } = await getSignedInUser();
    if (authError) return authError;
    const body = await request.json();
    const eventIds = Array.isArray(body.eventIds)
      ? ([
          ...new Set(body.eventIds.filter((v: unknown) => typeof v === 'string' && v.length < 80)),
        ] as string[])
      : typeof body.eventId === 'string'
        ? [body.eventId]
        : [];
    if (!eventIds.length || eventIds.length > 100)
      return NextResponse.json({ error: 'Provide one or more event IDs.' }, { status: 400 });
    const { db: admin, response: configError } = getConfiguredServiceClient(
      'Notification service is not configured.',
    );
    if (configError) return configError;
    const [{ data: profile }, { data: regs }] = await Promise.all([
      admin.from('profiles').select('role,application_status').eq('id', user.id).maybeSingle(),
      admin
        .from('registrations')
        .select('event_id')
        .eq('user_id', user.id)
        .in('event_id', eventIds),
    ]);
    const manager =
      profile?.application_status === 'approved' &&
      ['admin', 'organizer'].includes(profile.role ?? '');
    const ownEventIds = new Set((regs ?? []).map((r) => r.event_id));
    if (!manager && eventIds.some((id) => !ownEventIds.has(id)))
      return NextResponse.json(
        { error: 'Not authorized to dispatch notifications for this event.' },
        { status: 403 },
      );
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail =
      process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM;
    if (!resendKey || !fromEmail) {
      const missing = [
        !resendKey ? 'RESEND_API_KEY' : null,
        !fromEmail ? 'RESEND_FROM_EMAIL (a sender address on a domain verified in Resend)' : null,
      ].filter(Boolean);
      return NextResponse.json(
        { error: `Email delivery is not configured. Missing: ${missing.join('; ')}.` },
        { status: 503 },
      );
    }
    const { data: queue, error } = await admin
      .from('event_notification_queue')
      .select('id,event_id,user_id,notification_type')
      .in('event_id', eventIds)
      .is('sent_at', null)
      .order('created_at')
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let sent = 0;
    let failed = 0;
    const errors: { eventId: string; userId: string; email: string | null; error: string }[] = [];
    for (const item of queue ?? []) {
      const [{ data: recipient }, { data: event }, { data: reg }] = await Promise.all([
        admin
          .from('profiles')
          .select(
            'email,full_name,email_registration_updates,email_waitlist_updates,email_event_cancellations,email_registration_reminders,email_new_events,email_newsletter',
          )
          .eq('id', item.user_id)
          .maybeSingle(),
        admin
          .from('events')
          .select('title,slug,starts_at,location')
          .eq('id', item.event_id)
          .maybeSingle(),
        admin
          .from('registrations')
          .select('status,queue_position,created_at')
          .eq('event_id', item.event_id)
          .eq('user_id', item.user_id)
          .in('status', ['confirmed', 'waitlisted'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const preferenceKey: Record<string, string> = {
        registration_created: 'email_registration_updates',
        registration_cancelled: 'email_registration_updates',
        event_cancelled: 'email_event_cancellations',
        waitlist_confirmed: 'email_waitlist_updates',
        new_event_created: 'email_new_events',
      };
      const pref = preferenceKey[item.notification_type];
      if (pref && recipient && recipient[pref as keyof typeof recipient] === false) {
        await admin
          .from('event_notification_queue')
          .update({
            sent_at: new Date().toISOString(),
            last_error: 'Skipped by recipient email preference.',
          })
          .eq('id', item.id)
          .is('sent_at', null);
        continue;
      }
      const template = templates[item.notification_type];
      if (!recipient?.email || !event || !template) {
        await admin
          .from('event_notification_queue')
          .update({ last_error: 'Missing recipient, event, or template.' })
          .eq('id', item.id);
        failed++;
        continue;
      }
      const eventUrl = new URL(`/events/${event.slug || item.event_id}`, request.url).toString();
      const name = esc(recipient.full_name || 'member');
      const title = esc(event.title);
      const status =
        reg?.status === 'waitlisted'
          ? `You are on the waitlist${reg.queue_position ? ` at position ${reg.queue_position}` : ''}.`
          : reg?.status === 'confirmed'
            ? 'Your registration is confirmed.'
            : '';
      const subject =
        item.notification_type === 'registration_created'
          ? reg?.status === 'waitlisted'
            ? `You're on the waitlist: ${event.title}`
            : reg?.status === 'confirmed'
              ? `Registration confirmed: ${event.title}`
              : template.subject
          : template.subject;
      const html = `<p>Hello ${name},</p><p>${template.intro}</p><h2>${title}</h2><p>${esc(new Date(event.starts_at).toLocaleString('en-CA'))}${event.location ? ` · ${esc(event.location)}` : ''}</p>${status ? `<p><strong>Registration status:</strong> ${esc(status)}</p>` : ''}<p><a href="${esc(eventUrl)}">View event details</a></p><p>Port Coquitlam Tennis Club</p>`;
      const recordFailure = async (reason: string) => {
        await admin
          .from('event_notification_queue')
          .update({ last_error: reason })
          .eq('id', item.id);
        errors.push({
          eventId: item.event_id,
          userId: item.user_id,
          email: recipient.email,
          error: reason,
        });
        failed++;
      };
      try {
        const response = await sendResendEmail({
          apiKey: resendKey,
          from: fromEmail,
          to: recipient.email,
          subject,
          html,
        });
        if (response.ok) {
          await admin
            .from('event_notification_queue')
            .update({ sent_at: new Date().toISOString(), last_error: null })
            .eq('id', item.id)
            .is('sent_at', null);
          sent++;
        } else {
          const detail = (await response.text()).slice(0, 1000);
          await recordFailure(
            `Resend HTTP ${response.status}: ${detail || 'No error details returned.'}`,
          );
        }
      } catch (e) {
        await recordFailure(e instanceof Error ? e.message : 'Email send failed');
      }
    }
    return NextResponse.json({
      success: failed === 0,
      sent,
      failed,
      pending: (queue ?? []).length - sent - failed,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected server error.' },
      { status: 500 },
    );
  }
}
