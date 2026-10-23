import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  profile: { role: 'admin', application_status: 'approved' },
  history: [] as unknown[],
  error: null as null | { message: string },
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { GET } from '@/app/api/admin/email-history/route';

function serviceClient() {
  return {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: mocks.profile, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'profiles' ? mocks.profile : mocks.history,
            error: mocks.error,
          }).then(resolve, reject),
      };
      return query;
    },
  };
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.history = [{ id: 1, subject: 'Season update' }];
  mocks.error = null;
  mocks.createClient.mockImplementation(serviceClient);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/admin/email-history', () => {
  it('requires authentication, configured database, and approved administrator role', async () => {
    mocks.user = null;
    expect((await GET()).status).toBe(401);
    mocks.user = { id: 'admin-1' };
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect((await GET()).status).toBe(503);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    mocks.profile = { role: 'organizer', application_status: 'approved' };
    expect((await GET()).status).toBe(403);
    mocks.profile = { role: 'admin', application_status: 'pending' };
    expect((await GET()).status).toBe(403);
  });

  it('returns ordered history rows and propagates database failures', async () => {
    mocks.profile = { role: 'admin', application_status: 'approved' };
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: mocks.history });

    mocks.error = { message: 'history unavailable' };
    const failed = await GET();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'history unavailable' });
  });
});
