import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secret: 'cron-key',
  tables: {} as Record<string, unknown[]>,
  singleResults: [] as unknown[],
  logInsertError: null as null | { message: string; code?: string },
  tableErrors: {} as Record<string, { message: string }>,
  eventQueryError: null as null | { message: string },
  fetch: vi.fn(),
  createClient: vi.fn(),
  calls: [] as Array<{ table: string; operation: string; values?: unknown }>,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
import { GET } from '@/app/api/notifications/reminders/route';

function serviceClient() {
  return {
    from: (table: string) => {
      let operation = 'select';
      let values: unknown;
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        lte: () => query,
        in: () => query,
        order: () => query,
        range: () => query,
        insert: (payload: unknown) => {
          operation = 'insert';
          values = payload;
          mocks.calls.push({ table, operation, values });
          return query;
        },
        delete: () => {
          operation = 'delete';
          mocks.calls.push({ table, operation });
          return query;
        },
        maybeSingle: async () => ({ data: mocks.singleResults.shift() ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const response =
            table === 'event_email_log' && operation === 'insert'
              ? { data: null, error: mocks.logInsertError }
              : {
                  data: mocks.tables[`${table}.${operation}`] ?? mocks.tables[table] ?? [],
                  error:
                    table === 'events' ? mocks.eventQueryError : (mocks.tableErrors[table] ?? null),
                };
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      return query;
    },
  };
}
function request(auth = 'Bearer cron-key') {
  return new Request('https://club.example/api/notifications/reminders', {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  mocks.tables = {};
  mocks.singleResults = [];
  mocks.logInsertError = null;
  mocks.tableErrors = {};
  mocks.eventQueryError = null;
  mocks.calls = [];
  mocks.createClient.mockImplementation(serviceClient);
  mocks.fetch.mockReset().mockResolvedValue(new Response('provider rejected', { status: 500 }));
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('CRON_SECRET', 'cron-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('RESEND_API_KEY', 'resend-key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GET /api/notifications/reminders', () => {
  it('rejects invalid cron credentials and missing server/email configuration', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request('Bearer cron-key'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'cron-key');
    vi.stubEnv('RESEND_API_KEY', '');
    expect((await GET(request())).status).toBe(503);
  });

  it('returns database errors and succeeds with no events in the reminder window', async () => {
    mocks.eventQueryError = { message: 'database unavailable' };
    const failed = await GET(request());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'database unavailable' });
    mocks.eventQueryError = null;
    mocks.tables.events = [];
    const empty = await GET(request());
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ success: true, sent: 0, failed: 0, events: 0 });
  });

  describe('with an event whose registration just opened', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
      mocks.tables.events = [
        {
          id: 'event-1',
          slug: null,
          title: '<Club Finals>',
          starts_at: '2026-11-10T18:00:00Z',
          location: '<Court 1>',
          registration_opens_at: '2026-10-22T11:50:00Z',
        },
      ];
      mocks.tables.profiles = [
        { id: 'registered', email: 'registered@example.com', full_name: 'Registered' },
        { id: 'already-reminded', email: 'logged@example.com', full_name: 'Logged' },
        { id: 'no-email', email: null, full_name: 'No Email' },
        { id: 'unregistered', email: 'unregistered@example.com', full_name: '<Member>' },
      ];
      mocks.tables.registrations = [{ user_id: 'registered' }];
      mocks.tables.event_email_log = [{ user_id: 'already-reminded' }];
      mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    });

    it('mails only unregistered, not-yet-reminded members with an idempotency key, then records it', async () => {
      const response = await GET(request());
      expect(await response.json()).toEqual({ success: true, sent: 1, failed: 0, events: 1 });
      expect(mocks.fetch).toHaveBeenCalledOnce();
      const [, init] = mocks.fetch.mock.calls[0];
      const email = JSON.parse(init.body as string);
      expect(email.to).toEqual(['unregistered@example.com']);
      expect(email.html).toContain('&lt;Member&gt;');
      expect(email.html).toContain('&lt;Club Finals&gt;');
      expect(email.html).not.toContain('<Club Finals>');
      expect(init.headers['Idempotency-Key']).toBe('registration-reminder:event-1:unregistered');
      expect(mocks.calls.map((call) => call.table)).toEqual([
        'email_unsubscribe_tokens',
        'event_email_log',
      ]);
      expect(mocks.calls[1]).toEqual({
        table: 'event_email_log',
        operation: 'insert',
        values: {
          event_id: 'event-1',
          user_id: 'unregistered',
          email_type: 'registration_reminder',
        },
      });
    });

    it('records nothing and counts a failure when the provider rejects the email, so the next run retries', async () => {
      mocks.fetch.mockResolvedValue(new Response('provider rejected', { status: 500 }));
      const response = await GET(request());
      expect(await response.json()).toEqual({ success: true, sent: 0, failed: 1, events: 1 });
      expect(mocks.calls.map((call) => call.table)).toEqual(['email_unsubscribe_tokens']);
      expect(mocks.calls.some((call) => call.table === 'event_email_log')).toBe(false);
    });

    it('counts a failure when sending throws', async () => {
      mocks.fetch.mockRejectedValue(new Error('network down'));
      const response = await GET(request());
      expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
      expect(mocks.calls.map((call) => call.table)).toEqual(['email_unsubscribe_tokens']);
      expect(mocks.calls.some((call) => call.table === 'event_email_log')).toBe(false);
    });

    it('still counts the reminder as sent when a parallel run already recorded it', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.logInsertError = { message: 'duplicate key', code: '23505' };
      const response = await GET(request());
      expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
      expect(error).not.toHaveBeenCalled();
    });

    it('logs but does not fail when recording the sent reminder fails for another reason', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.logInsertError = { message: 'db down' };
      const response = await GET(request());
      expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
      expect(error).toHaveBeenCalledWith(
        '[Reminders] Could not record sent reminder',
        expect.objectContaining({ eventId: 'event-1' }),
      );
    });

    it('sends nothing for an event when registrations or the reminder log cannot be read', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.tableErrors.registrations = { message: 'boom' };
      const response = await GET(request());
      expect(await response.json()).toMatchObject({ sent: 0, failed: 0, events: 1 });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    });

    it('returns 500 when recipients cannot be loaded', async () => {
      mocks.tableErrors.profiles = { message: 'boom' };
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });
});
