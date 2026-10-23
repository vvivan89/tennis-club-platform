import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  profile: { role: 'admin', application_status: 'approved' },
  ids: [{ id: 'recipient-1' }, { id: 'recipient-2' }],
  recipients: [
    { id: 'recipient-1', email: 'member@example.com', full_name: `A <Member>` },
    { id: 'recipient-2', email: null, full_name: null },
  ],
  history: null as null | { message: string },
  createClient: vi.fn(),
  fetch: vi.fn(),
  insertedHistory: [] as Array<Record<string, unknown>>,
  profileIds: [] as string[][],
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { POST } from '@/app/api/admin/send-email/route';

function serviceClient() {
  return {
    from: (table: string) => {
      let selection = '';
      let operation = 'select';
      let values: Record<string, unknown> = {};
      const query = {
        select: (columns = '*') => {
          selection = columns;
          return query;
        },
        eq: () => query,
        or: () => query,
        in: (_column: string, ids: string[]) => {
          mocks.profileIds.push(ids);
          return query;
        },
        update: (payload: Record<string, unknown>) => {
          operation = 'update';
          values = payload;
          return query;
        },
        insert: (payload: Record<string, unknown>) => {
          operation = 'insert';
          values = payload;
          if (table === 'email_announcement_history') mocks.insertedHistory.push(payload);
          return query;
        },
        maybeSingle: async () => ({ data: mocks.profile, error: null }),
        then: (
          resolve: (value: { data: unknown[]; error: typeof mocks.history }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          const data =
            table === 'profiles'
              ? selection === 'id,email,full_name'
                ? mocks.recipients
                : mocks.ids
              : table === 'memberships'
                ? [{ user_id: 'recipient-1' }, { user_id: 'recipient-1' }]
                : [];
          const error =
            table === 'email_announcement_history' && operation === 'insert' ? mocks.history : null;
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function request(body: unknown) {
  return new Request('https://club.example/api/admin/send-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.ids = [{ id: 'recipient-1' }, { id: 'recipient-2' }];
  mocks.recipients = [
    { id: 'recipient-1', email: 'member@example.com', full_name: 'A <Member>' },
    { id: 'recipient-2', email: null, full_name: null },
  ];
  mocks.history = null;
  mocks.insertedHistory = [];
  mocks.profileIds = [];
  mocks.createClient.mockImplementation(serviceClient);
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('RESEND_API_KEY', 'resend-key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('POST /api/admin/send-email', () => {
  it('enforces sign-in, email configuration, and approved administrator role', async () => {
    mocks.user = null;
    expect((await POST(request({ subject: 'Notice', html: '<p>Hi</p>' }))).status).toBe(401);
    mocks.user = { id: 'admin-1' };
    vi.stubEnv('RESEND_API_KEY', '');
    expect((await POST(request({ subject: 'Notice', html: '<p>Hi</p>' }))).status).toBe(503);
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    mocks.profile = { role: 'organizer', application_status: 'approved' };
    expect((await POST(request({ subject: 'Notice', html: '<p>Hi</p>' }))).status).toBe(403);
  });

  it('requires a subject and non-script body text', async () => {
    expect((await POST(request({ subject: ' ', html: '<script>alert(1)</script>' }))).status).toBe(
      400,
    );
  });

  it('sanitizes active markup, escapes names, counts failures, and records a history row', async () => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const response = await POST(
      request({
        subject: ' Club Update ',
        group: 'all',
        html: '<p onclick="bad()">Hello</p><script>alert(1)</script>',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, sent: 1, failed: 1 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const mail = JSON.parse(mocks.fetch.mock.calls[0][1].body as string);
    expect(mail.subject).toBe('Club Update');
    expect(mail.html).toContain('A &lt;Member&gt;');
    expect(mail.html).toContain('<p>Hello</p>');
    expect(mail.html).not.toContain('onclick');
    expect(mail.html).not.toContain('<script>');
    expect(mocks.insertedHistory[0]).toMatchObject({
      subject: 'Club Update',
      recipient_group: 'all',
      sent_by: 'admin-1',
      sent_count: 1,
      failed_count: 1,
    });
  });

  it('deduplicates active-member IDs before sending and tolerates history write failure', async () => {
    mocks.ids = [{ id: 'recipient-1' }];
    mocks.recipients = [{ id: 'recipient-1', email: 'member@example.com', full_name: 'Member' }];
    mocks.history = { message: 'history write failed' };
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const response = await POST(
      request({ subject: 'Notice', html: '<p>Content</p>', group: 'active_members' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, sent: 1, failed: 0 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.profileIds).toContainEqual(['recipient-1']);
  });
});
