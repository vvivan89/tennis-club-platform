import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string; email_confirmed_at?: string },
  authResponse: null as null | Response,
  rows: {} as Record<string, unknown[]>,
  rpcError: null as null | { message: string },
  rpc: vi.fn(),
}));

vi.mock('@/lib/api-helpers', () => ({
  getSignedInUser: async () => ({ user: mocks.user, response: mocks.authResponse }),
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
}));
vi.mock('@/lib/supabase-service', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        maybeSingle: async () => ({ data: mocks.rows[table]?.shift() ?? null, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));

import { GET, POST } from '@/app/api/events/partner-confirmation/route';

const participantId = '22222222-2222-4222-8222-222222222222';
const participant = {
  id: participantId,
  event_id: 'event-1',
  user_id: 'guest-1',
  category: 'mixed',
  display_name: 'Taylor Guest',
  email: 'guest@example.test',
  phone: '604-555-0100',
  gender: 'female',
  tennis_skill_level: '3.5',
  status: 'registered',
  confirmation_status: 'pending',
  event: { id: 'event-1', slug: 'summer-open', title: 'Summer Open' },
};
function get(
  url = `https://club.test/api/events/partner-confirmation?participantId=${participantId}`,
) {
  return GET(new Request(url));
}
function post(body: unknown) {
  return POST(
    new Request('https://club.test/api/events/partner-confirmation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
function validInvitation() {
  mocks.rows = {
    tournament_participants: [participant, { display_name: 'Alex Inviter' }],
    tournament_pairs: [{ player_one_id: 'inviter-1', player_two_id: participantId }],
  };
}

beforeEach(() => {
  mocks.user = { id: 'guest-1', email: 'guest@example.test', email_confirmed_at: 'confirmed' };
  mocks.authResponse = null;
  mocks.rpcError = null;
  mocks.rpc.mockReset().mockImplementation(async () => ({ error: mocks.rpcError }));
  validInvitation();
});
afterEach(() => vi.clearAllMocks());

describe('partner confirmation endpoints', () => {
  it('requires a verified signed-in email and a valid invitation ID', async () => {
    mocks.authResponse = new Response(JSON.stringify({ error: 'Sign in first' }), { status: 401 });
    expect((await get()).status).toBe(401);
    mocks.authResponse = null;
    mocks.user = { id: 'guest-1', email: 'guest@example.test' };
    expect((await get()).status).toBe(403);
    mocks.user.email_confirmed_at = 'confirmed';
    expect((await get('https://club.test/api/events/partner-confirmation')).status).toBe(400);
  });

  it('rejects unavailable or mismatched invitations and missing active pairs', async () => {
    mocks.rows.tournament_participants = [{ ...participant, confirmation_status: 'confirmed' }];
    expect((await get()).status).toBe(404);
    mocks.rows.tournament_participants = [{ ...participant, email: 'other@example.test' }];
    expect((await get()).status).toBe(404);
    mocks.rows.tournament_participants = [participant];
    mocks.rows.tournament_pairs = [];
    expect((await get()).status).toBe(404);
  });

  it('returns only the invited player details and inviter name without caching', async () => {
    validInvitation();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      participant: {
        id: participantId,
        displayName: 'Taylor Guest',
        email: 'guest@example.test',
        phone: '604-555-0100',
        gender: 'female',
        tennisSkillLevel: '3.5',
      },
      event: participant.event,
      invitedBy: 'Alex Inviter',
    });
  });

  it('confirms a valid invitation through the database RPC and reports RPC errors', async () => {
    validInvitation();
    expect((await post({ participantId })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_tournament_partner', {
      p_participant_id: participantId,
    });
    expect((await post({ participantId: 'bad' })).status).toBe(400);
    mocks.rpcError = { message: 'Invitation is no longer pending.' };
    validInvitation();
    const failed = await post({ participantId });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({ error: 'Invitation is no longer pending.' });
  });

  it('turns malformed bodies and service failures into safe errors', async () => {
    const malformed = await POST(
      new Request('https://club.test/api/events/partner-confirmation', {
        method: 'POST',
        body: '{',
      }),
    );
    expect(malformed.status).toBe(500);
  });
});
