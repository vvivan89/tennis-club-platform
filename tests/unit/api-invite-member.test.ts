import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  role: 'admin',
  inviteError: null as null | { message: string },
  invitedUser: { id: 'new-member-1' } as null | { id: string },
  membershipError: null as null | { message: string },
  createClient: vi.fn(),
  calls: [] as Array<{ table: string; operation: string; values: unknown }>,
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

import { POST } from '@/app/api/admin/invite-member/route';

function serviceClient() {
  return {
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, options: unknown) => {
          mocks.calls.push({ table: 'auth', operation: 'invite', values: { email, options } });
          return { data: { user: mocks.invitedUser }, error: mocks.inviteError };
        },
      },
    },
    from: (table: string) => {
      let operation = '';
      let values: unknown;
      const query = {
        update: (payload: unknown) => {
          operation = 'update';
          values = payload;
          return query;
        },
        insert: (payload: unknown) => {
          operation = 'insert';
          values = payload;
          return query;
        },
        eq: () => query,
        then: (
          resolve: (value: { data: null; error: typeof mocks.membershipError }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          mocks.calls.push({ table, operation, values });
          const error = table === 'memberships' ? mocks.membershipError : null;
          return Promise.resolve({ data: null, error }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function request(body: unknown) {
  return new Request('https://club.example/api/admin/invite-member', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const valid = {
  full_name: 'Taylor Member',
  email: ' TAYLOR@EXAMPLE.COM ',
  phone: ' 604-555-0123 ',
  tennis_skill_level: '3.5',
  gender: 'female',
  date_of_birth: '1990-05-14',
};

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.role = 'admin';
  mocks.inviteError = null;
  mocks.invitedUser = { id: 'new-member-1' };
  mocks.membershipError = null;
  mocks.calls = [];
  mocks.createClient.mockImplementation(serviceClient);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/admin/invite-member', () => {
  it('rejects anonymous and non-admin callers', async () => {
    mocks.user = null;
    expect((await POST(request(valid))).status).toBe(401);
    mocks.user = { id: 'organizer-1' };
    mocks.role = 'organizer';
    expect((await POST(request(valid))).status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('normalizes values and validates all required profile fields', async () => {
    expect((await POST(request({ ...valid, full_name: ' ' }))).status).toBe(400);
    expect((await POST(request({ ...valid, email: ' ' }))).status).toBe(400);
    expect((await POST(request({ ...valid, phone: ' ' }))).status).toBe(400);
    expect((await POST(request({ ...valid, tennis_skill_level: '8.0' }))).status).toBe(400);
    expect((await POST(request({ ...valid, gender: '' }))).status).toBe(400);
    expect((await POST(request({ ...valid, date_of_birth: '' }))).status).toBe(400);
    expect((await POST(request({ ...valid, gender: 'other' }))).status).toBe(400);
    expect((await POST(request({ ...valid, date_of_birth: '2020-02-31' }))).status).toBe(400);
    expect((await POST(request({ ...valid, date_of_birth: '2999-01-01' }))).status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('creates the invited user, approves their profile, and provisions an unpaid membership', async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.calls).toHaveLength(3);
    expect(mocks.calls[0]).toMatchObject({
      table: 'auth',
      operation: 'invite',
      values: {
        email: 'taylor@example.com',
        options: {
          data: {
            full_name: 'Taylor Member',
            phone: '604-555-0123',
            tennis_skill_level: '3.5',
            gender: 'female',
            date_of_birth: '1990-05-14',
          },
        },
      },
    });
    expect(mocks.calls[1]).toMatchObject({
      table: 'profiles',
      operation: 'update',
      values: { application_status: 'approved' },
    });
    expect(mocks.calls[2]).toMatchObject({
      table: 'memberships',
      operation: 'insert',
      values: {
        user_id: 'new-member-1',
        membership_type: 'annual',
        status: 'pending',
        payment_status: 'unpaid',
      },
    });
  });

  it('surfaces invite and membership creation failures without claiming completion', async () => {
    mocks.inviteError = { message: 'email already registered' };
    const inviteFailure = await POST(request(valid));
    expect(inviteFailure.status).toBe(400);
    expect(await inviteFailure.json()).toEqual({ error: 'email already registered' });

    mocks.inviteError = null;
    mocks.membershipError = { message: 'membership insert failed' };
    const membershipFailure = await POST(request(valid));
    expect(membershipFailure.status).toBe(500);
    expect(await membershipFailure.json()).toMatchObject({
      error: expect.stringContaining('membership insert failed'),
    });
  });

  it('returns clear errors when service configuration or the invited user is missing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const missingConfig = await POST(request(valid));
    expect(missingConfig.status).toBe(500);
    expect(await missingConfig.json()).toMatchObject({
      error: expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY'),
    });

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    mocks.invitedUser = null;
    const missingUser = await POST(request(valid));
    expect(missingUser.status).toBe(500);
    expect(await missingUser.json()).toEqual({ error: 'Invitation did not create a user.' });
  });
});
