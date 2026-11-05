import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  authResponse: null as null | Response,
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
        maybeSingle: async () => ({ data: mocks.singles[table]?.shift() ?? null, error: null }),
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

import { POST } from '@/app/api/events/tournament-registration-confirmation/route';

const participantId = '11111111-1111-4111-8111-111111111111';
const userId = 'member-1';

function request(id = participantId) {
  return new Request('https://club.test/api/events/tournament-registration-confirmation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ participantId: id }),
  });
}

function configureSingleRegistration() {
  mocks.singles = {
    tournament_participants: [
      {
        id: participantId,
        event_id: 'event-1',
        user_id: userId,
        email: 'player@example.test',
        display_name: 'Player One',
        status: 'registered',
        confirmation_status: 'confirmed',
      },
    ],
    tournament_pairs: [null],
    events: [
      {
        id: 'event-1',
        title: 'Summer Open',
        slug: 'summer-open',
        starts_at: '2027-06-01T18:00:00.000Z',
        location: 'PCTC Courts',
        status: 'published',
        event_type: 'tournament',
      },
    ],
    profiles: [{ email_registration_updates: true }],
  };
}

beforeEach(() => {
  mocks.user = { id: userId };
  mocks.authResponse = null;
  mocks.email.mockReset().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  configureSingleRegistration();
});
afterEach(() => vi.clearAllMocks());

describe('tournament single-registration confirmation email endpoint', () => {
  it('sends the registration confirmation to the signed-in player', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 1, skipped: 0 });
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'player@example.test',
        subject: 'Registration confirmed: Summer Open',
        idempotencyKey: `tournament-registration-confirmation:${participantId}`,
      }),
    );
  });

  it('rejects another player’s registration and paired registrations', async () => {
    mocks.singles.tournament_participants = [
      {
        id: participantId,
        event_id: 'event-1',
        user_id: 'someone-else',
        email: 'player@example.test',
        display_name: 'Player One',
        status: 'registered',
        confirmation_status: 'confirmed',
      },
    ];
    expect((await POST(request())).status).toBe(404);

    configureSingleRegistration();
    mocks.singles.tournament_pairs = [{ id: 'pair-1' }];
    expect((await POST(request())).status).toBe(409);
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('honors the registration email preference', async () => {
    mocks.singles.profiles = [{ email_registration_updates: false }];

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, skipped: 1 });
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs and unauthenticated requests', async () => {
    expect((await POST(request('bad'))).status).toBe(400);
    mocks.user = null;
    expect((await POST(request())).status).toBe(401);
  });
});
