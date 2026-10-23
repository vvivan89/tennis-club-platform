import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as null | { id: string },
  profile: { role: 'member', application_status: 'approved' } as null | Record<string, unknown>,
  data: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
  membershipResults: null as null | unknown[][],
  singles: {} as Record<string, unknown[]>,
  updates: [] as unknown[],
  inserts: [] as unknown[],
  fetch: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { POST as dispatchPost } from '@/app/api/notifications/dispatch/route';
import { GET as registrationRemindersGet } from '@/app/api/notifications/reminders/route';
import { GET as membershipRemindersGet } from '@/app/api/notifications/membership-reminders/route';

function client() {
  return {
    from: (table: string) => {
      let operation = 'select';
      let updateValues: unknown;
      const result = { data: mocks.data[table] ?? [], error: null };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gte: () => query,
        lte: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const queue = mocks.singles[table];
          return {
            data: queue?.length ? queue.shift() : table === 'profiles' ? mocks.profile : null,
            error: null,
          };
        },
        update: (values: unknown) => {
          operation = 'update';
          updateValues = values;
          return query;
        },
        insert: (values: unknown) => {
          operation = 'insert';
          updateValues = values;
          return query;
        },
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(
            operation === 'update'
              ? { data: [], error: null }
              : {
                  ...result,
                  data:
                    table === 'memberships' && mocks.membershipResults
                      ? (mocks.membershipResults.shift() ?? [])
                      : result.data,
                  error: mocks.errors[table] ?? null,
                },
          ).then((value) => {
            if (operation === 'update') mocks.updates.push({ table, values: updateValues });
            if (operation === 'insert') mocks.inserts.push({ table, values: updateValues });
            return resolve(value as typeof result);
          }, reject),
      };
      return query;
    },
  };
}

function postRequest(body: unknown, url = 'https://club.example/api/notifications/dispatch') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function cronRequest(auth?: string, path = 'reminders') {
  return new Request(`https://club.example/api/notifications/${path}`, {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  mocks.user = { id: 'user-1' };
  mocks.profile = { role: 'member', application_status: 'approved' };
  mocks.data = {};
  mocks.errors = {};
  mocks.membershipResults = null;
  mocks.singles = {};
  mocks.updates = [];
  mocks.inserts = [];
  mocks.createClient.mockImplementation(client);
  mocks.fetch.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('CRON_SECRET', 'cron-key');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('RESEND_FROM_EMAIL', '');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('notification endpoints', () => {
  it('requires authentication and valid event IDs for dispatch', async () => {
    mocks.user = null;
    expect((await dispatchPost(postRequest({ eventId: 'e1' }))).status).toBe(401);
    mocks.user = { id: 'user-1' };
    expect((await dispatchPost(postRequest({ eventIds: [] }))).status).toBe(400);
    expect(
      (
        await dispatchPost(
          postRequest({ eventIds: Array.from({ length: 101 }, (_, i) => `e${i}`) }),
        )
      ).status,
    ).toBe(400);
  });

  it('limits dispatch to event managers or users registered for every requested event', async () => {
    mocks.profile = { role: 'member', application_status: 'approved' };
    mocks.data.registrations = [];
    const denied = await dispatchPost(postRequest({ eventIds: ['event-1'] }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining('Not authorized') });

    mocks.profile = { role: 'admin', application_status: 'approved' };
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.data.event_notification_queue = [];
    const authorized = await dispatchPost(postRequest({ eventId: 'event-1' }));
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({
      success: true,
      sent: 0,
      failed: 0,
      pending: 0,
    });
  });

  it('delivers queued registration emails with escaped content and marks the queue item sent', async () => {
    mocks.profile = { role: 'admin', application_status: 'approved' };
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.data.event_notification_queue = [
      {
        id: 'queue-1',
        event_id: 'event-1',
        user_id: 'recipient-1',
        notification_type: 'registration_created',
      },
    ];
    mocks.singles.profiles = [
      mocks.profile,
      {
        email: 'member@example.com',
        full_name: '<Player>',
        email_registration_updates: true,
        email_waitlist_updates: true,
        email_event_cancellations: true,
        email_registration_reminders: true,
        email_new_events: true,
        email_newsletter: true,
      },
    ];
    mocks.singles.events = [
      {
        title: '<Finals>',
        slug: 'finals',
        starts_at: '2026-06-01T10:00:00Z',
        location: 'Court <1>',
      },
    ];
    mocks.singles.registrations = [
      { status: 'confirmed', queue_position: null, created_at: '2026-05-01' },
    ];
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, sent: 1, failed: 0, pending: 0 });
    const message = JSON.parse(mocks.fetch.mock.calls[0][1].body as string);
    expect(message.html).toContain('&lt;Player&gt;');
    expect(message.html).toContain('&lt;Finals&gt;');
    expect(message.html).not.toContain('<Finals>');
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({ table: 'event_notification_queue' }),
    );
  });

  it('does not send when recipient preferences disable registration updates', async () => {
    mocks.profile = { role: 'admin', application_status: 'approved' };
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.data.event_notification_queue = [
      {
        id: 'queue-2',
        event_id: 'event-1',
        user_id: 'recipient-1',
        notification_type: 'registration_created',
      },
    ];
    mocks.singles.profiles = [
      mocks.profile,
      { email: 'member@example.com', full_name: 'Member', email_registration_updates: false },
    ];
    const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
    expect(response.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        table: 'event_notification_queue',
        values: expect.objectContaining({ last_error: 'Skipped by recipient email preference.' }),
      }),
    );
  });

  it('records unsendable queue entries when the recipient, event, or template is missing', async () => {
    mocks.profile = { role: 'admin', application_status: 'approved' };
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.data.event_notification_queue = [
      {
        id: 'queue-unknown',
        event_id: 'event-1',
        user_id: 'recipient-1',
        notification_type: 'unknown',
      },
      {
        id: 'queue-missing',
        event_id: 'event-2',
        user_id: 'recipient-2',
        notification_type: 'registration_created',
      },
    ];
    mocks.singles.profiles = [
      mocks.profile,
      { email: 'member@example.com', full_name: 'Member' },
      { email: null, full_name: 'No email' },
    ];
    mocks.singles.events = [
      { title: 'Event', slug: 'event', starts_at: '2026-10-22T12:00:00Z', location: null },
      null,
    ];
    mocks.singles.registrations = [null, null];

    const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
    expect(await response.json()).toMatchObject({ success: false, sent: 0, failed: 2, pending: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        table: 'event_notification_queue',
        values: { last_error: 'Missing recipient, event, or template.' },
      }),
    );
  });

  it('captures both network exceptions and provider rejection details for queued mail', async () => {
    mocks.profile = { role: 'admin', application_status: 'approved' };
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.data.event_notification_queue = [
      {
        id: 'queue-network',
        event_id: 'event-1',
        user_id: 'recipient-1',
        notification_type: 'registration_created',
      },
      {
        id: 'queue-provider',
        event_id: 'event-1',
        user_id: 'recipient-2',
        notification_type: 'registration_created',
      },
    ];
    mocks.singles.profiles = [
      mocks.profile,
      { email: 'one@example.com', full_name: 'One' },
      { email: 'two@example.com', full_name: 'Two' },
    ];
    mocks.singles.events = [
      { title: '<Finals>', slug: null, starts_at: '2026-10-22T12:00:00Z', location: null },
      { title: 'Finals', slug: null, starts_at: '2026-10-22T12:00:00Z', location: 'Court 1' },
    ];
    mocks.singles.registrations = [
      { status: 'confirmed', queue_position: null },
      { status: 'waitlisted', queue_position: 0 },
    ];
    mocks.fetch
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }));

    const response = await dispatchPost(postRequest({ eventIds: ['event-1', 'event-1'] }));
    const result = await response.json();
    expect(result).toMatchObject({ success: false, sent: 0, failed: 2, pending: 0 });
    expect(result.errors).toEqual([
      expect.objectContaining({ error: 'connection reset', email: 'one@example.com' }),
      expect.objectContaining({ error: 'Resend HTTP 429: rate limited', email: 'two@example.com' }),
    ]);
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        table: 'event_notification_queue',
        values: { last_error: 'connection reset' },
      }),
    );
    expect(mocks.fetch.mock.calls[1][1].body).toContain("You're on the waitlist: Finals");
  });

  it('rejects invalid cron credentials and reports missing mail configuration', async () => {
    expect((await registrationRemindersGet(cronRequest('Bearer wrong'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect(
      (await membershipRemindersGet(cronRequest('Bearer cron-key', 'membership-reminders'))).status,
    ).toBe(401);
    vi.stubEnv('CRON_SECRET', 'cron-key');
    expect((await registrationRemindersGet(cronRequest('Bearer cron-key'))).status).toBe(503);
  });

  it('returns successful no-op results when no registration reminders or membership settings are due', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.data.events = [];
    const registrationResponse = await registrationRemindersGet(cronRequest('Bearer cron-key'));
    expect(registrationResponse.status).toBe(200);
    expect(await registrationResponse.json()).toMatchObject({
      success: true,
      sent: 0,
      failed: 0,
      events: 0,
    });

    const membershipResponse = await membershipRemindersGet(
      cronRequest('Bearer cron-key', 'membership-reminders'),
    );
    expect(membershipResponse.status).toBe(200);
    expect(await membershipResponse.json()).toMatchObject({
      success: true,
      sent: 0,
      reason: 'Membership settings not configured',
    });
  });

  it('sends a membership reminder only to unpaid members and logs the reminder', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.singles.membership_plan_settings = [
      {
        season_start_month: 10,
        season_start_day: 29,
        season_end_month: 9,
        season_end_day: 30,
      },
    ];
    mocks.data.profiles = [{ id: 'unpaid-1', email: 'member@example.com', full_name: '<Member>' }];
    mocks.singles.membership_reminder_log = [null];
    mocks.singles.membership_family_members = [null];
    mocks.data.memberships = [];
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await membershipRemindersGet(
      cronRequest('Bearer cron-key', 'membership-reminders'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      season: 2026,
      type: 'before',
      sent: 1,
      failed: 0,
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body as string);
    expect(body.html).toContain('&lt;Member&gt;');
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        table: 'membership_reminder_log',
        values: { season_year: 2026, reminder_type: 'before', user_id: 'unpaid-1' },
      }),
    );
    vi.useRealTimers();
  });

  it('sends post-season reminders only to unpaid members without a prior reminder log', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    mocks.singles.membership_plan_settings = [
      {
        season_start_month: 10,
        season_start_day: 29,
        season_end_month: 9,
        season_end_day: 30,
      },
    ];
    mocks.data.profiles = [
      { id: 'family-paid', email: 'family@example.com', full_name: 'Family Paid' },
      { id: 'membership-paid', email: 'membership@example.com', full_name: 'Membership Paid' },
      { id: 'already-reminded', email: 'logged@example.com', full_name: 'Logged Member' },
      { id: 'unpaid-one', email: 'unpaid@example.com', full_name: 'Unpaid One' },
      { id: 'unpaid-two', email: 'failed@example.com', full_name: null },
    ];
    mocks.singles.membership_reminder_log = [null, null, { id: 'existing-log' }, null, null];
    mocks.singles.membership_family_members = [
      { membership_families: { paid_at: '2026-10-01', season_year: 2026 } },
      null,
      null,
      null,
      null,
    ];
    mocks.membershipResults = [
      [],
      [{ id: 'membership-2', ends_on: '2026-09-30', status: 'active' }],
      [],
      [],
      [],
    ];
    mocks.singles.payments = [{ id: 'payment-2' }];
    mocks.fetch
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('mail provider failed', { status: 500 }));

    const response = await membershipRemindersGet(
      cronRequest('Bearer cron-key', 'membership-reminders'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      season: 2026,
      type: 'after',
      sent: 1,
      failed: 1,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][1].body).toContain('season began on 2026-10-29');
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body as string).to).toEqual([
      'unpaid@example.com',
    ]);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body as string).to).toEqual([
      'failed@example.com',
    ]);
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        table: 'membership_reminder_log',
        values: { season_year: 2026, reminder_type: 'after', user_id: 'unpaid-one' },
      }),
    );
  });
});
