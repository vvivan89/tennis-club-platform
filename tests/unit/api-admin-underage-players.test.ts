import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string; application_status: string },
  event: null as null | { created_by: string; organizer_id: string | null },
  serviceLists: {} as Record<string, unknown[][]>,
  serviceCalls: [] as string[],
}));

vi.mock('@/lib/api-helpers', () => ({
  getSignedInUser: async () => ({
    user: mocks.user,
    response: mocks.user ? null : new Response(null, { status: 401 }),
    auth: {
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: table === 'profiles' ? mocks.profile : mocks.event,
            error: null,
          }),
        };
        return query;
      },
    },
  }),
  getConfiguredServiceClient: () => ({
    db: {
      from: (table: string) => {
        mocks.serviceCalls.push(table);
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve({ data: mocks.serviceLists[table]?.shift() ?? [], error: null }).then(
              resolve,
              reject,
            ),
        };
        return query;
      },
    },
    response: null,
  }),
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
}));

import { GET } from '@/app/api/admin/events/[eventId]/underage-players/route';

const eventId = '11111111-1111-4111-8111-111111111111';
const playerId = '22222222-2222-4222-8222-222222222222';
const detailsId = '33333333-3333-4333-8333-333333333333';

function get() {
  return GET(new Request(`https://club.test/api/admin/events/${eventId}/underage-players`), {
    params: Promise.resolve({ eventId }),
  });
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.event = { created_by: 'organizer-1', organizer_id: 'organizer-1' };
  mocks.serviceCalls = [];
  mocks.serviceLists = {
    tournament_participants: [[{ id: playerId, user_id: null }]],
    player_private_details: [
      [{ id: detailsId, participant_id: playerId, profile_id: null, date_of_birth: '2012-05-14' }],
      [],
    ],
    player_legal_guardians: [
      [
        {
          private_details_id: detailsId,
          full_name: 'Morgan Parent',
          email: 'morgan@example.test',
          phone: null,
        },
      ],
    ],
  };
});
afterEach(() => vi.clearAllMocks());

describe('admin underage tournament player details endpoint', () => {
  it('returns age and guardian contacts to an authorized event manager', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      players: {
        [playerId]: {
          age: expect.any(Number),
          guardians: [{ name: 'Morgan Parent', email: 'morgan@example.test', phone: null }],
        },
      },
    });
  });

  it('denies an unrelated organizer before loading guardian records', async () => {
    mocks.profile = { role: 'organizer', application_status: 'approved' };
    mocks.user = { id: 'other-organizer' };
    const response = await get();
    expect(response.status).toBe(403);
    expect(mocks.serviceCalls).toEqual([]);
  });

  it('requires sign-in', async () => {
    mocks.user = null;
    const response = await get();
    expect(response.status).toBe(401);
    expect(mocks.serviceCalls).toEqual([]);
  });
});
