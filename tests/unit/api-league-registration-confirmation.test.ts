import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  authResponse: null as null | Response,
  lists: {} as Record<string, unknown[][]>,
  singles: {} as Record<string, unknown[]>,
  email: vi.fn(),
}));

vi.mock('@/lib/api-helpers', () => ({
  getSignedInUser: async () => ({
    user: mocks.user,
    response: mocks.authResponse ?? (!mocks.user ? new Response(null, { status: 401 }) : null),
  }),
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
}));
vi.mock('@/lib/supabase-service', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        in: () => query,
        maybeSingle: async () => ({ data: mocks.singles[table]?.shift() ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: mocks.lists[table]?.shift() ?? [], error: null }).then(
            resolve,
            reject,
          ),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/site-url', () => ({ getSiteOrigin: () => 'https://club.test' }));
vi.mock('@/lib/resend', () => ({
  escapeHtml: (value: string) => value,
  sendResendEmail: mocks.email,
}));

import { POST } from '@/app/api/events/league-registration-confirmation/route';

const playerOneId = '11111111-1111-4111-8111-111111111111';
const playerTwoId = '22222222-2222-4222-8222-222222222222';
const pairId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';

function request(participantId: string = playerOneId) {
  return new Request('https://club.test/api/events/league-registration-confirmation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ participantId }),
  });
}

function configureConfirmedPair() {
  mocks.singles = {
    tournament_participants: [{ id: playerOneId, event_id: eventId, user_id: 'member-one' }],
    tournament_pairs: [
      {
        id: pairId,
        player_one_id: playerOneId,
        player_two_id: playerTwoId,
        league_team_id: 'league-team-1',
      },
    ],
    events: [
      {
        id: eventId,
        title: 'League Event 2',
        slug: 'league-event-2',
        starts_at: '2027-06-01T18:00:00.000Z',
        location: 'PCTC Courts',
        status: 'published',
      },
    ],
  };
  mocks.lists = {
    tournament_participants: [
      [
        {
          id: playerOneId,
          event_id: eventId,
          user_id: 'member-one',
          email: 'one@example.test',
          display_name: 'Player One',
          status: 'registered',
          confirmation_status: 'confirmed',
        },
        {
          id: playerTwoId,
          event_id: eventId,
          user_id: 'member-two',
          email: 'two@example.test',
          display_name: 'Player Two',
          status: 'registered',
          confirmation_status: 'confirmed',
        },
      ],
    ],
    profiles: [
      [
        { id: 'member-one', email_registration_updates: true },
        { id: 'member-two', email_registration_updates: true },
      ],
    ],
  };
}

beforeEach(() => {
  mocks.user = { id: 'member-one' };
  mocks.authResponse = null;
  mocks.email.mockReset().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  configureConfirmedPair();
});
afterEach(() => vi.clearAllMocks());

describe('League registration confirmation email endpoint', () => {
  it('sends the current event registration confirmation to both confirmed teammates', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, skipped: 0 });
    expect(mocks.email).toHaveBeenCalledTimes(2);
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'one@example.test',
        subject: 'Registration confirmed: League Event 2',
        idempotencyKey: `league-registration-confirmation:${eventId}:${pairId}:member-one`,
        html: expect.stringContaining('Your registration is confirmed.'),
      }),
    );
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'two@example.test',
        subject: 'Registration confirmed: League Event 2',
        idempotencyKey: `league-registration-confirmation:${eventId}:${pairId}:member-two`,
      }),
    );
  });

  it('rejects a caller who is not one of the fixed team players', async () => {
    mocks.user = { id: 'someone-else' };
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('does not email players whose registration update preference is disabled', async () => {
    mocks.lists.profiles = [
      [
        { id: 'member-one', email_registration_updates: false },
        { id: 'member-two', email_registration_updates: false },
      ],
    ];
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, skipped: 2 });
    expect(mocks.email).not.toHaveBeenCalled();
  });
});
