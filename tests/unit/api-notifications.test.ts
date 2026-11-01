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
  deletes: [] as unknown[],
  insertErrors: {} as Record<string, { code: string; message: string }>,
  orFilters: [] as string[],
  claimedRows: null as null | unknown[],
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
      let returning = false;
      const result = { data: mocks.data[table] ?? [], error: null };
      const query = {
        select: () => {
          if (operation === 'update') returning = true;
          return query;
        },
        eq: () => query,
        or: (filter: string) => {
          mocks.orFilters.push(filter);
          return query;
        },
        in: () => query,
        gte: () => query,
        lte: () => query,
        is: () => query,
        order: () => query,
        range: () => query,
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
        delete: () => {
          operation = 'delete';
          return query;
        },
        insert: (values: unknown) => {
          operation = 'insert';
          updateValues = values;
          return query;
        },
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(
            operation === 'update' && returning
              ? { data: mocks.claimedRows ?? mocks.data[table] ?? [], error: null }
              : operation === 'update' || operation === 'delete'
                ? { data: [], error: null }
                : operation === 'insert'
                  ? { data: [], error: mocks.insertErrors[table] ?? null }
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
            if (operation === 'delete') mocks.deletes.push({ table });
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
  mocks.deletes = [];
  mocks.insertErrors = {};
  mocks.orFilters = [];
  mocks.claimedRows = null;
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

  describe('event notification dispatch', () => {
    const queueItem = (id: string, userId = 'recipient-1', type = 'registration_created') => ({
      id,
      event_id: 'event-1',
      user_id: userId,
      notification_type: type,
    });
    const recipient = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      email: `${id}@example.com`,
      full_name: id,
      ...extra,
    });
    const event = {
      id: 'event-1',
      title: 'Finals',
      slug: 'finals',
      starts_at: '2026-06-01T10:00:00Z',
      location: null,
    };
    const queueUpdates = () =>
      mocks.updates.filter(
        (u) => (u as { table: string }).table === 'event_notification_queue',
      ) as Array<{
        values: Record<string, unknown>;
      }>;

    beforeEach(() => {
      mocks.profile = { role: 'admin', application_status: 'approved' };
      vi.stubEnv('RESEND_API_KEY', 'resend-key');
      vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
      mocks.data.events = [event];
      mocks.data.registrations = [];
      mocks.data.profiles = [];
    });

    it('limits dispatch to event managers or users registered for every requested event', async () => {
      mocks.profile = { role: 'member', application_status: 'approved' };
      const denied = await dispatchPost(postRequest({ eventIds: ['event-1'] }));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({
        error: expect.stringContaining('Not authorized'),
      });

      mocks.profile = { role: 'admin', application_status: 'approved' };
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

    it('claims queue rows before sending, then delivers escaped mail with an idempotency key and marks it sent', async () => {
      mocks.data.event_notification_queue = [queueItem('queue-1')];
      mocks.data.profiles = [
        recipient('recipient-1', { full_name: '<Player>', email_registration_updates: true }),
      ];
      mocks.data.events = [{ ...event, title: '<Finals>', location: 'Court <1>' }];
      mocks.data.registrations = [
        {
          event_id: 'event-1',
          user_id: 'recipient-1',
          status: 'confirmed',
          queue_position: null,
          created_at: '2026-05-01',
        },
      ];
      mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }));

      const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
      expect(await response.json()).toMatchObject({
        success: true,
        sent: 1,
        failed: 0,
        pending: 0,
      });
      const [, init] = mocks.fetch.mock.calls[0];
      const message = JSON.parse(init.body as string);
      expect(message.html).toContain('&lt;Player&gt;');
      expect(message.html).toContain('&lt;Finals&gt;');
      expect(message.html).not.toContain('<Finals>');
      expect(init.headers['Idempotency-Key']).toBe('event-notification:queue-1');
      const updates = queueUpdates().map((u) => u.values);
      expect(updates[0]).toEqual({ claimed_at: expect.any(String) });
      expect(updates).toContainEqual({ sent_at: expect.any(String), last_error: null });
      expect(mocks.orFilters[0]).toMatch(/^claimed_at\.is\.null,claimed_at\.lt\./);
    });

    it('does not send rows another run has already claimed', async () => {
      mocks.data.event_notification_queue = [queueItem('queue-1')];
      mocks.claimedRows = [];
      const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
      expect(await response.json()).toMatchObject({ sent: 0, failed: 0, pending: 0 });
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('does not send when recipient preferences disable registration updates', async () => {
      mocks.data.event_notification_queue = [queueItem('queue-2')];
      mocks.data.profiles = [recipient('recipient-1', { email_registration_updates: false })];
      const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
      expect(response.status).toBe(200);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(queueUpdates().map((u) => u.values)).toContainEqual({
        sent_at: expect.any(String),
        last_error: 'Skipped by recipient email preference.',
      });
    });

    it('records and releases unsendable entries when the recipient, event, or template is missing', async () => {
      mocks.data.event_notification_queue = [
        queueItem('queue-unknown', 'recipient-1', 'unknown'),
        { ...queueItem('queue-missing', 'recipient-2'), event_id: 'event-2' },
      ];
      mocks.data.profiles = [recipient('recipient-1'), recipient('recipient-2', { email: null })];

      const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
      expect(await response.json()).toMatchObject({
        success: false,
        sent: 0,
        failed: 2,
        pending: 0,
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(queueUpdates().map((u) => u.values)).toContainEqual({
        last_error: 'Missing recipient, event, or template.',
        claimed_at: null,
      });
    });

    it('captures network exceptions and provider rejections, in queue order, and releases the claims', async () => {
      mocks.data.event_notification_queue = [
        queueItem('queue-network', 'recipient-1'),
        queueItem('queue-provider', 'recipient-2'),
      ];
      mocks.data.profiles = [recipient('recipient-1'), recipient('recipient-2')];
      mocks.fetch
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce(new Response('rate limited', { status: 429 }));

      const response = await dispatchPost(postRequest({ eventIds: ['event-1', 'event-1'] }));
      const result = await response.json();
      expect(result).toMatchObject({ success: false, sent: 0, failed: 2, pending: 0 });
      expect(result.errors).toEqual([
        expect.objectContaining({ error: 'connection reset', email: 'recipient-1@example.com' }),
        expect.objectContaining({
          error: 'Resend HTTP 429: rate limited',
          email: 'recipient-2@example.com',
        }),
      ]);
      const updates = queueUpdates().map((u) => u.values);
      expect(updates).toContainEqual({ last_error: 'connection reset', claimed_at: null });
      expect(updates).toContainEqual({
        last_error: 'Resend HTTP 429: rate limited',
        claimed_at: null,
      });
    });

    it('releases the claims and returns 500 when notification details cannot be loaded', async () => {
      mocks.data.event_notification_queue = [queueItem('queue-1')];
      mocks.errors.events = { message: 'boom' };
      const response = await dispatchPost(postRequest({ eventId: 'event-1' }));
      expect(response.status).toBe(500);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(queueUpdates().map((u) => u.values)).toContainEqual({ claimed_at: null });
    });
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

  describe('membership reminders', () => {
    const settings = {
      season_start_month: 10,
      season_start_day: 29,
      season_end_month: 9,
      season_end_day: 30,
    };
    const family = (year: number, paid: boolean) => ({
      paid_at: paid ? `${year}-10-01` : null,
      season_year: year,
    });
    const reminderRequest = () => cronRequest('Bearer cron-key', 'membership-reminders');
    const sentTo = () =>
      mocks.fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).to[0] as string);

    beforeEach(() => {
      vi.stubEnv('RESEND_API_KEY', 'resend-key');
      vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
      mocks.singles.membership_plan_settings = [settings];
      mocks.data.membership_reminder_log = [];
      mocks.data.membership_family_members = [];
      mocks.data.memberships = [];
      mocks.data.payments = [];
    });

    it('sends a pre-season reminder to an unpaid member, claims the log row first and sends an idempotency key', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
      mocks.data.profiles = [
        { id: 'unpaid-1', email: 'member@example.com', full_name: '<Member>' },
      ];

      const response = await membershipRemindersGet(reminderRequest());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        season: 2026,
        type: 'before',
        sent: 1,
        failed: 0,
      });
      const [, init] = mocks.fetch.mock.calls[0];
      expect(JSON.parse(init.body as string).html).toContain('&lt;Member&gt;');
      expect(init.headers['Idempotency-Key']).toBe('membership-reminder:2026:before:unpaid-1');
      expect(mocks.inserts).toContainEqual(
        expect.objectContaining({
          table: 'membership_reminder_log',
          values: { season_year: 2026, reminder_type: 'before', user_id: 'unpaid-1' },
        }),
      );
      expect(mocks.deletes).toHaveLength(0);
    });

    it('skips members covered by a paid family, an own paid membership, or an earlier reminder', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
      mocks.data.profiles = [
        { id: 'family-paid', email: 'a@example.com', full_name: 'A' },
        { id: 'left-paid-family', email: 'b@example.com', full_name: 'B' },
        { id: 'two-seasons', email: 'c@example.com', full_name: 'C' },
        { id: 'membership-paid', email: 'd@example.com', full_name: 'D' },
        { id: 'membership-via-payment', email: 'e@example.com', full_name: 'E' },
        { id: 'already-reminded', email: 'f@example.com', full_name: 'F' },
        { id: 'unpaid-one', email: 'g@example.com', full_name: 'G' },
      ];
      mocks.data.membership_reminder_log = [{ user_id: 'already-reminded' }];
      mocks.data.membership_family_members = [
        { user_id: 'family-paid', status: 'confirmed', membership_families: family(2026, true) },
        {
          user_id: 'left-paid-family',
          status: 'removed_next_season',
          membership_families: [family(2026, true)],
        },
        { user_id: 'two-seasons', status: 'confirmed', membership_families: family(2025, true) },
        { user_id: 'two-seasons', status: 'confirmed', membership_families: family(2026, true) },
      ];
      mocks.data.memberships = [
        { id: 'm-1', user_id: 'membership-paid', ends_on: null, payment_status: 'paid' },
        {
          id: 'm-2',
          user_id: 'membership-via-payment',
          ends_on: '2026-09-30',
          payment_status: 'unpaid',
        },
      ];
      mocks.data.payments = [{ business_record_id: 'm-2' }];

      const response = await membershipRemindersGet(reminderRequest());
      expect(await response.json()).toMatchObject({ type: 'after', sent: 1, failed: 0 });
      expect(sentTo()).toEqual(['g@example.com']);
    });

    it('does not treat other-season, declined or unpaid-family rows as coverage', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
      mocks.data.profiles = [
        { id: 'last-season-only', email: 'a@example.com', full_name: 'A' },
        { id: 'declined', email: 'b@example.com', full_name: 'B' },
        { id: 'unpaid-family', email: 'c@example.com', full_name: 'C' },
        { id: 'no-family-single', email: 'd@example.com', full_name: 'D' },
      ];
      mocks.data.membership_family_members = [
        {
          user_id: 'last-season-only',
          status: 'removed_next_season',
          membership_families: family(2025, true),
        },
        { user_id: 'declined', status: 'declined', membership_families: family(2026, true) },
        { user_id: 'unpaid-family', status: 'confirmed', membership_families: family(2026, false) },
      ];

      await membershipRemindersGet(reminderRequest());
      expect(sentTo().sort()).toEqual([
        'a@example.com',
        'b@example.com',
        'c@example.com',
        'd@example.com',
      ]);
    });

    it('releases the claim and counts a failure when the provider rejects the email', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
      mocks.data.profiles = [{ id: 'unpaid-two', email: 'failed@example.com', full_name: null }];
      mocks.fetch.mockResolvedValueOnce(new Response('mail provider failed', { status: 500 }));

      const response = await membershipRemindersGet(reminderRequest());
      expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
      expect(mocks.deletes).toContainEqual({ table: 'membership_reminder_log' });
    });

    it('does not send when another run already claimed the reminder', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
      mocks.data.profiles = [{ id: 'unpaid-1', email: 'a@example.com', full_name: 'A' }];
      mocks.insertErrors.membership_reminder_log = { code: '23505', message: 'duplicate key' };

      const response = await membershipRemindersGet(reminderRequest());
      expect(await response.json()).toMatchObject({ sent: 0, failed: 0 });
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('sends nothing when payment data cannot be loaded', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
      mocks.data.profiles = [{ id: 'unpaid-1', email: 'a@example.com', full_name: 'A' }];
      mocks.errors.membership_family_members = { message: 'boom' };

      const response = await membershipRemindersGet(reminderRequest());
      expect(response.status).toBe(500);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });
});
