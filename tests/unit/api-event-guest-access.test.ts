import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  rateLimits: [] as Array<Response | null>,
  rateLimitCalls: [] as unknown[],
  otp: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase-service', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      let column = '';
      const query = {
        select: () => query,
        eq: (key: string) => {
          column = key;
          return query;
        },
        maybeSingle: async () => ({ data: mocks.rows[table] ?? null, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: async (...args: unknown[]) => {
    mocks.rateLimitCalls.push(args);
    return mocks.rateLimits.shift() ?? null;
  },
}));
vi.mock('@/lib/site-url', () => ({ getSiteOrigin: () => 'https://club.test' }));

import { POST } from '@/app/api/events/guest-access/route';

const eventId = '22222222-2222-4222-8222-222222222222';
function request(body: unknown) {
  return new Request('https://club.test/api/events/guest-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function limited() {
  return new Response(JSON.stringify({ error: 'Too many requests.' }), { status: 429 });
}

beforeEach(() => {
  mocks.rows = {
    events: {
      id: eventId,
      slug: 'summer-open',
      status: 'published',
      event_type: 'tournament',
      allow_non_member_registration: true,
    },
  };
  mocks.rateLimits = [];
  mocks.rateLimitCalls = [];
  mocks.otp.mockReset().mockResolvedValue({ error: null });
  mocks.createClient.mockReturnValue({ auth: { signInWithOtp: mocks.otp } });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://club.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/events/guest-access', () => {
  it('validates email and event IDs before rate limiting', async () => {
    expect((await POST(request({ email: 'bad', eventId }))).status).toBe(400);
    expect((await POST(request({ email: 'a@example.test', eventId: 'not-an-id' }))).status).toBe(
      400,
    );
    expect(mocks.rateLimitCalls).toHaveLength(0);
  });

  it('applies IP and normalized-email rate limits', async () => {
    mocks.rateLimits = [limited()];
    expect((await POST(request({ email: 'a@example.test', eventId }))).status).toBe(429);
    expect(mocks.rateLimitCalls).toHaveLength(1);

    mocks.rateLimits = [null, limited()];
    expect((await POST(request({ email: ' A@EXAMPLE.TEST ', eventId }))).status).toBe(429);
    expect(mocks.rateLimitCalls).toHaveLength(3);
  });

  it('rejects events that do not permit public tournament registration', async () => {
    mocks.rows.events = { ...(mocks.rows.events as object), event_type: 'social' };
    const response = await POST(request({ email: 'a@example.test', eventId }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'This event is not accepting event-only registrations.',
    });
  });

  it('directs existing member and non-member accounts to sign in', async () => {
    mocks.rows.profiles = {
      id: 'member-1',
      account_kind: 'member',
      application_status: 'approved',
    };
    const member = await POST(request({ email: 'a@example.test', eventId }));
    expect(await member.json()).toMatchObject({
      memberLoginRequired: true,
      message: 'Please log in as a member.',
    });

    mocks.rows.profiles = {
      id: 'applicant-1',
      account_kind: 'member',
      application_status: 'pending',
    };
    const existing = await POST(request({ email: 'a@example.test', eventId }));
    expect(await existing.json()).toMatchObject({
      memberLoginRequired: true,
      message: 'Please log in with your existing PCTC account.',
    });
  });

  it('sends a guest sign-in link with a safe event return path', async () => {
    const response = await POST(request({ email: ' GUEST@EXAMPLE.TEST ', eventId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: true });
    expect(mocks.createClient).toHaveBeenCalledWith('https://club.supabase.co', 'publishable', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect(mocks.otp).toHaveBeenCalledWith({
      email: 'guest@example.test',
      options: {
        shouldCreateUser: true,
        data: { account_kind: 'event_guest' },
        emailRedirectTo: 'https://club.test/auth/guest-callback?next=%2Fevents%2Fsummer-open',
      },
    });
  });

  it('reports configuration, auth-provider, and malformed-request errors safely', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined);
    await POST(request({ email: 'a@example.test', eventId }));
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://club.supabase.co',
      'anon',
      expect.any(Object),
    );

    mocks.createClient.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const missing = await POST(request({ email: 'a@example.test', eventId }));
    expect(missing.status).toBe(500);
    expect(mocks.createClient).not.toHaveBeenCalled();

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://club.supabase.co');
    mocks.otp.mockResolvedValueOnce({ error: new Error('provider unavailable') });
    expect((await POST(request({ email: 'a@example.test', eventId }))).status).toBe(500);
    expect(
      (await POST(new Request('https://club.test', { method: 'POST', body: '{' }))).status,
    ).toBe(500);
  });
});
