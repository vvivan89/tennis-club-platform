import { NextResponse } from 'next/server';
import { getSignedInUser, getConfiguredServiceClient } from '@/lib/api-helpers';
import { escapeHtml as esc, sendResendEmail } from '@/lib/resend';
import { getSiteOrigin } from '@/lib/site-url';
import { mapInChunks } from '@/lib/async';

const SEND_CONCURRENCY = 10;
/** A claim older than this is assumed to belong to a crashed run and may be retaken. */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

type RegistrationRow = {
  event_id: string;
  user_id: string;
  status: string;
  queue_position: number | null;
};
type QueueItem = { id: string; event_id: string; user_id: string; notification_type: string };

const templates: Record<string, { subject: string; intro: string }> = {
  registration_created: {
    subject: 'Your event registration',
    intro: 'Your registration has been recorded. Your current registration status is shown below.',
  },
  registration_cancelled: {
    subject: 'Your event registration was cancelled',
    intro: 'Your event registration has been cancelled.',
  },
  event_cancelled: {
    subject: 'Event cancelled',
    intro: 'An event you registered for has been cancelled by the club.',
  },
  waitlist_confirmed: {
    subject: 'Your place in an event is confirmed',
    intro: 'A place has opened and you have been moved from the waitlist to confirmed.',
  },
  new_event_created: {
    subject: 'New event announced',
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
    if (!eventIds.length || eventIds.length > 200)
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
    const claimTimeoutBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
    // Unclaimed, or claimed so long ago that the claiming run must have died.
    const claimable = `claimed_at.is.null,claimed_at.lt.${claimTimeoutBefore}`;
    const { data: pending, error } = await admin
      .from('event_notification_queue')
      .select('id')
      .in('event_id', eventIds)
      .is('sent_at', null)
      .or(claimable)
      .order('created_at')
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const pendingIds = (pending ?? []).map((row) => row.id as string);
    const { data: claimedRows, error: claimError } = pendingIds.length
      ? await admin
          .from('event_notification_queue')
          .update({ claimed_at: new Date().toISOString() })
          .in('id', pendingIds)
          .is('sent_at', null)
          .or(claimable)
          .select('id,event_id,user_id,notification_type')
      : { data: [], error: null };
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
    const queue = (claimedRows ?? []) as QueueItem[];
    const { data: clubSettings } = await admin
      .from('club_settings')
      .select('short_name')
      .eq('id', 1)
      .maybeSingle();
    const shortName = clubSettings?.short_name || 'Tennis Club';

    const releaseClaims = async (ids: string[]) => {
      if (ids.length)
        await admin.from('event_notification_queue').update({ claimed_at: null }).in('id', ids);
    };

    const userIds = [...new Set(queue.map((item) => item.user_id))];
    const queueEventIds = [...new Set(queue.map((item) => item.event_id))];
    const [recipientsResult, eventsResult, registrationsResult] = queue.length
      ? await Promise.all([
          admin
            .from('profiles')
            .select(
              'id,email,full_name,email_registration_updates,email_waitlist_updates,email_event_cancellations,email_registration_reminders,email_new_events,email_newsletter',
            )
            .in('id', userIds),
          admin
            .from('events')
            .select('id,title,slug,starts_at,location,series_id')
            .in('id', queueEventIds),
          admin
            .from('registrations')
            .select('event_id,user_id,status,queue_position,created_at')
            .in('event_id', queueEventIds)
            .in('user_id', userIds)
            .in('status', ['confirmed', 'waitlisted'])
            .order('created_at', { ascending: false }),
        ])
      : [null, null, null];
    if (recipientsResult?.error || eventsResult?.error || registrationsResult?.error) {
      await releaseClaims(queue.map((item) => item.id));
      return NextResponse.json({ error: 'Could not load notification details.' }, { status: 500 });
    }
    const seriesIds = [
      ...new Set(
        (eventsResult?.data ?? [])
          .map((event) => event.series_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [seriesResult, seriesEventsResult] = seriesIds.length
      ? await Promise.all([
          admin.from('event_series').select('id,recurrence_rule,starts_on').in('id', seriesIds),
          admin
            .from('events')
            .select('id,title,slug,starts_at,location,series_id')
            .in('series_id', seriesIds)
            .eq('status', 'published')
            .order('starts_at'),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
    if (seriesResult.error || seriesEventsResult.error) {
      await releaseClaims(queue.map((item) => item.id));
      return NextResponse.json(
        { error: 'Could not load recurring event details.' },
        { status: 500 },
      );
    }
    const recipientById = new Map(
      (recipientsResult?.data ?? []).map((r) => [r.id as string, r] as const),
    );
    const eventById = new Map((eventsResult?.data ?? []).map((e) => [e.id as string, e] as const));
    const seriesById = new Map(
      (seriesResult.data ?? []).map((series) => [series.id as string, series] as const),
    );
    const nextEventBySeries = new Map<string, (typeof seriesEventsResult.data)[number]>();
    const nowMs = Date.now();
    for (const event of seriesEventsResult.data ?? []) {
      const seriesId = event.series_id as string;
      if (!nextEventBySeries.has(seriesId) && new Date(event.starts_at).getTime() >= nowMs)
        nextEventBySeries.set(seriesId, event);
    }
    for (const event of seriesEventsResult.data ?? []) {
      const seriesId = event.series_id as string;
      if (!nextEventBySeries.has(seriesId)) nextEventBySeries.set(seriesId, event);
    }
    // Rows are newest first, so the first one seen per event and user is the latest.
    const registrationByKey = new Map<string, RegistrationRow>();
    for (const reg of (registrationsResult?.data ?? []) as RegistrationRow[]) {
      const registrationKey = `${reg.event_id}:${reg.user_id}`;
      if (!registrationByKey.has(registrationKey)) registrationByKey.set(registrationKey, reg);
    }

    const preferenceKey: Record<string, string> = {
      registration_created: 'email_registration_updates',
      registration_cancelled: 'email_registration_updates',
      event_cancelled: 'email_event_cancellations',
      waitlist_confirmed: 'email_waitlist_updates',
      new_event_created: 'email_new_events',
    };

    type Outcome =
      | { status: 'sent' | 'skipped' }
      | {
          status: 'failed';
          error: { eventId: string; userId: string; email: string | null; error: string };
        };

    const processItem = async (item: QueueItem): Promise<Outcome> => {
      const recipient = recipientById.get(item.user_id);
      const queuedEvent = eventById.get(item.event_id);
      const seriesId = queuedEvent?.series_id as string | null;
      const event = seriesId ? nextEventBySeries.get(seriesId) || queuedEvent : queuedEvent;
      const series = seriesId ? seriesById.get(seriesId) : null;
      const reg = registrationByKey.get(`${item.event_id}:${item.user_id}`);
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
        return { status: 'skipped' };
      }
      const template = templates[item.notification_type];
      const fail = async (reason: string): Promise<Outcome> => {
        // Release the claim so the next dispatch can retry.
        await admin
          .from('event_notification_queue')
          .update({ last_error: reason, claimed_at: null })
          .eq('id', item.id);
        return {
          status: 'failed',
          error: {
            eventId: item.event_id,
            userId: item.user_id,
            email: recipient?.email ?? null,
            error: reason,
          },
        };
      };
      if (!recipient?.email || !event || !template)
        return fail('Missing recipient, event, or template.');
      const eventUrl = new URL(
        `/events/${event.slug || item.event_id}`,
        getSiteOrigin(request),
      ).toString();
      const name = esc(recipient.full_name || 'member');
      const title = esc(event.title);
      const recurrence = series?.recurrence_rule as
        { frequency?: string; day_of_week?: number } | undefined;
      const weekdays = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      const weekday =
        typeof recurrence?.day_of_week === 'number' ? weekdays[recurrence.day_of_week] : null;
      const seriesStart = series?.starts_on ? new Date(`${series.starts_on}T12:00:00`) : null;
      const monthlyOrdinal = seriesStart ? Math.floor((seriesStart.getDate() - 1) / 7) : null;
      const ordinalNames = ['first', 'second', 'third', 'fourth', 'fifth'];
      const monthlyDescription =
        seriesStart && monthlyOrdinal !== null
          ? seriesStart.getDate() + 7 >
            new Date(seriesStart.getFullYear(), seriesStart.getMonth() + 1, 0).getDate()
            ? 'last'
            : ordinalNames[monthlyOrdinal]
          : null;
      const schedule =
        weekday && recurrence?.frequency === 'weekly'
          ? `Every ${weekday}`
          : weekday && recurrence?.frequency === 'biweekly'
            ? `Every other ${weekday}`
            : weekday && recurrence?.frequency === 'monthly'
              ? `Monthly on the ${monthlyDescription || 'same'} ${weekday}`
              : null;
      const status =
        reg?.status === 'waitlisted'
          ? `You are on the waitlist${reg.queue_position ? ` at position ${reg.queue_position}` : ''}.`
          : reg?.status === 'confirmed'
            ? 'Your registration is confirmed.'
            : '';
      const subject =
        shortName +
        ' — ' +
        (item.notification_type === 'registration_created'
          ? reg?.status === 'waitlisted'
            ? `You're on the waitlist: ${event.title}`
            : reg?.status === 'confirmed'
              ? `Registration confirmed: ${event.title}`
              : template.subject
          : template.subject);
      const html = `<p>Hello ${name},</p><p>${template.intro}</p><h2>${title}</h2>${schedule ? `<p><strong>Schedule:</strong> ${esc(schedule)}.</p>` : ''}<p><strong>${schedule ? 'Next session:' : 'Date:'}</strong> ${esc(new Date(event.starts_at).toLocaleString('en-CA'))}${event.location ? ` · ${esc(event.location)}` : ''}</p>${status ? `<p><strong>Registration status:</strong> ${esc(status)}</p>` : ''}<p><a href="${esc(eventUrl)}">View event details</a></p><p>${esc(shortName)}</p>`;
      try {
        const response = await sendResendEmail({
          apiKey: resendKey,
          from: fromEmail,
          to: recipient.email,
          subject,
          html,
          idempotencyKey: `event-notification:${item.id}`,
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 1000);
          return fail(`Resend HTTP ${response.status}: ${detail || 'No error details returned.'}`);
        }
      } catch (e) {
        return fail(e instanceof Error ? e.message : 'Email send failed');
      }
      const { error: markError } = await admin
        .from('event_notification_queue')
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq('id', item.id)
        .is('sent_at', null);
      if (markError)
        console.error('[Notifications] Could not mark queue item sent', {
          id: item.id,
          message: markError.message,
        });
      return { status: 'sent' };
    };

    const outcomes = await mapInChunks(queue, SEND_CONCURRENCY, processItem);
    const sent = outcomes.filter((o) => o.status === 'sent').length;
    const errors = outcomes.flatMap((o) => (o.status === 'failed' ? [o.error] : []));
    const failed = errors.length;
    return NextResponse.json({
      success: failed === 0,
      sent,
      failed,
      pending: queue.length - sent - failed,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected server error.' },
      { status: 500 },
    );
  }
}
