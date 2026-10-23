import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  role: 'admin',
  application: {
    id: 'member-1',
    email: 'member@example.com',
    full_name: '<script>alert(1)</script>',
    application_status: 'pending',
  } as null | Record<string, unknown>,
  updateError: null as null | { message: string },
  updates: [] as Array<Record<string, unknown>>,
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { role: mocks.role }, error: null }),
      };
      return query;
    },
  }),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { POST } from '@/app/api/admin/applications/route';

function serviceClient() {
  return {
    from: (table: string) => {
      let operation = 'select';
      let updateValues: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.application : null,
          error: null,
        }),
        update: (values: Record<string, unknown>) => {
          operation = 'update';
          updateValues = values;
          return query;
        },
        then: (
          resolve: (value: { data: null; error: typeof mocks.updateError }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          if (operation === 'update') mocks.updates.push(updateValues);
          return Promise.resolve({ data: null, error: mocks.updateError }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function request(body: unknown) {
  return new Request('https://club.example/api/admin/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.role = 'admin';
  mocks.application = {
    id: 'member-1',
    email: 'member@example.com',
    full_name: '<script>alert(1)</script>',
    application_status: 'pending',
  };
  mocks.updateError = null;
  mocks.updates = [];
  mocks.createClient.mockImplementation(serviceClient);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('RESEND_FROM_EMAIL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('POST /api/admin/applications', () => {
  it('enforces authentication and administrator authorization', async () => {
    mocks.user = null;
    expect((await POST(request({ userId: 'member-1', action: 'approve' }))).status).toBe(401);
    mocks.user = { id: 'organizer-1' };
    mocks.role = 'organizer';
    expect((await POST(request({ userId: 'member-1', action: 'approve' }))).status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('rejects invalid actions and missing server credentials', async () => {
    expect((await POST(request({ userId: '', action: 'delete' }))).status).toBe(400);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect((await POST(request({ userId: 'member-1', action: 'dismiss' }))).status).toBe(500);
  });

  it('rejects applications that are missing or already processed', async () => {
    mocks.application = null;
    expect((await POST(request({ userId: 'member-1', action: 'dismiss' }))).status).toBe(404);
    mocks.application = { id: 'member-1', application_status: 'approved' };
    expect((await POST(request({ userId: 'member-1', action: 'dismiss' }))).status).toBe(409);
    expect(mocks.updates).toEqual([]);
  });

  it('dismisses a pending application without assigning a role', async () => {
    const response = await POST(request({ userId: 'member-1', action: 'dismiss' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, emailSent: false });
    expect(mocks.updates).toEqual([{ application_status: 'dismissed' }]);
  });

  it('approves, escapes the recipient name, and reports the email provider message ID', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'club@example.com');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request({ userId: 'member-1', action: 'approve' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      emailSent: true,
      resendMessageId: 'email-1',
    });
    expect(mocks.updates).toEqual([{ application_status: 'approved', role: 'member' }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body.html).not.toContain('<script>');
  });

  it('retains a successful approval when email configuration or delivery fails', async () => {
    const response = await POST(request({ userId: 'member-1', action: 'approve' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      emailSent: false,
      emailError: expect.stringContaining('RESEND_API_KEY'),
    });
    expect(mocks.updates).toEqual([{ application_status: 'approved', role: 'member' }]);
  });

  it('returns persistence errors instead of reporting a successful decision', async () => {
    mocks.updateError = { message: 'write failed' };
    const response = await POST(request({ userId: 'member-1', action: 'dismiss' }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'write failed' });
  });
});
