import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  authResponse: null as null | Response,
  lists: {} as Record<string, unknown[][]>,
  singles: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
  listErrors: {} as Record<string, Array<{ message: string } | null>>,
  otp: vi.fn(),
  email: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/api-helpers', () => ({
  getSignedInUser: async () => ({
    user: mocks.user,
    response: mocks.authResponse ?? (!mocks.user ? new Response(null, { status: 401 }) : null),
  }),
}));
vi.mock('@/lib/supabase-service', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: async () => ({
          data: mocks.singles[table]?.shift() ?? null,
          error: mocks.errors[`${table}.maybeSingle`] ?? null,
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.lists[table]?.shift() ?? [],
            error: mocks.listErrors[table]?.shift() ?? mocks.errors[table] ?? null,
          }).then(resolve, reject),
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
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { POST } from '@/app/api/events/partner-invitations/route';

const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
const entries = [
  {
    id: one,
    event_id: 'event-1',
    user_id: null,
    display_name: '<Guest One>',
    email: 'one@example.test',
    status: 'registered',
    confirmation_status: 'pending',
    updated_at: '2026-01-01',
  },
  {
    id: two,
    event_id: 'event-1',
    user_id: null,
    display_name: 'Guest Two',
    email: 'two@example.test',
    status: 'registered',
    confirmation_status: 'pending',
    updated_at: '2026-01-01',
  },
];
function request(body: unknown) {
  return new Request('https://club.test/api/events/partner-invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function configureManagerPair() {
  mocks.errors = {};
  mocks.listErrors = {};
  mocks.lists = {
    tournament_participants: [
      entries,
      [
        { id: one, display_name: 'Inviter One' },
        { id: two, display_name: 'Inviter Two' },
      ],
    ],
    tournament_pairs: [[{ player_one_id: one, player_two_id: two }]],
  };
  mocks.singles = {
    profiles: [
      { role: 'admin', application_status: 'approved' },
      { id: 'member-1', account_kind: 'member' },
      null,
    ],
    events: [
      {
        slug: 'summer-open',
        title: 'Summer Open',
        created_by: 'organizer-1',
        organizer_id: 'organizer-1',
      },
    ],
  };
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.authResponse = null;
  mocks.errors = {};
  mocks.listErrors = {};
  mocks.otp.mockReset().mockResolvedValue({ error: null });
  mocks.email.mockReset().mockResolvedValue({ ok: true });
  mocks.createClient.mockReturnValue({ auth: { signInWithOtp: mocks.otp } });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://club.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable');
  configureManagerPair();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/events/partner-invitations', () => {
  it('requires authentication and one or two valid unique participant IDs', async () => {
    mocks.user = null;
    expect((await POST(request({ participantIds: [one] }))).status).toBe(401);
    mocks.user = { id: 'manager-1' };
    expect((await POST(request({ participantIds: [] }))).status).toBe(400);
    expect((await POST(request({ participantIds: ['bad', 'also-bad'] }))).status).toBe(400);
    expect(
      (await POST(request({ participantIds: [one, two, '33333333-3333-4333-8333-333333333333'] })))
        .status,
    ).toBe(400);
  });

  it('requires all entries to exist in one event and await confirmation', async () => {
    mocks.lists.tournament_participants = [[entries[0]]];
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(404);
    mocks.lists.tournament_participants = [
      [{ ...entries[0], confirmation_status: 'confirmed' }, entries[1]],
    ];
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(409);
    mocks.lists.tournament_participants = [[entries[0], { ...entries[1], event_id: 'event-2' }]];
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(409);
    mocks.lists.tournament_participants = [[{ ...entries[0], email: null }, entries[1]]];
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(409);
  });

  it('returns missing-event and forbidden errors without sending invitations', async () => {
    mocks.singles.events = [null];
    expect((await POST(request({ participantIds: [one] }))).status).toBe(404);
    configureManagerPair();
    mocks.singles.profiles[0] = { role: 'member', application_status: 'approved' };
    mocks.singles.events[0] = {
      slug: null,
      title: 'Open',
      created_by: 'another',
      organizer_id: null,
    };
    mocks.lists.tournament_participants = [[entries[0]]];
    mocks.lists.tournament_pairs = [[]];
    const forbidden = await POST(request({ participantIds: [one] }));
    expect(forbidden.status).toBe(403);
    expect(mocks.otp).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('sends account emails and guest magic links with inviter attribution', async () => {
    configureManagerPair();
    const response = await POST(request({ participantIds: [one, two] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      invitations: [
        { participantId: one, sent: true },
        { participantId: two, sent: true },
      ],
    });
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'one@example.test',
        subject: 'Confirm your place with Inviter Two',
        html: expect.stringContaining('Inviter Two has listed you'),
      }),
    );
    expect(mocks.otp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'two@example.test',
        options: expect.objectContaining({
          shouldCreateUser: true,
          emailRedirectTo: expect.stringContaining('/auth/guest-callback?next='),
        }),
      }),
    );
  });

  it('reports provider, query, and malformed-body failures safely', async () => {
    configureManagerPair();
    mocks.email.mockResolvedValueOnce({ ok: false });
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(500);

    configureManagerPair();
    mocks.otp.mockResolvedValueOnce({ error: new Error('provider failed') });
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(500);

    const malformed = await POST(new Request('https://club.test', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(500);
  });

  it('handles organizer permissions and rejects lookup failures before sending mail', async () => {
    mocks.singles.profiles[0] = { role: 'organizer', application_status: 'approved' };
    mocks.singles.events[0] = {
      slug: 'summer-open',
      title: 'Summer Open',
      created_by: 'admin-1',
      organizer_id: 'admin-1',
    };
    mocks.lists.tournament_participants[0] = [entries[0]];
    const organizer = await POST(request({ participantIds: [one] }));
    expect(organizer.status).toBe(200);
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Confirm your place with Inviter Two',
      }),
    );

    configureManagerPair();
    mocks.errors.tournament_participants = { message: 'participant lookup failed' };
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(404);

    configureManagerPair();
    mocks.errors.tournament_pairs = { message: 'pair lookup failed' };
    expect((await POST(request({ participantIds: [one, two] }))).status).toBe(500);
  });

  it('sends guest links to event-only accounts and reports inviter lookup failures', async () => {
    configureManagerPair();
    mocks.singles.profiles[1] = { id: 'guest-1', account_kind: 'event_guest' };
    mocks.lists.tournament_participants[0] = [entries[0]];
    const response = await POST(request({ participantIds: [one] }));
    expect(response.status).toBe(200);
    expect(mocks.otp).toHaveBeenCalledWith(expect.objectContaining({ email: 'one@example.test' }));

    configureManagerPair();
    mocks.lists.tournament_participants[0] = [entries[0]];
    mocks.listErrors.tournament_participants = [null, { message: 'inviter lookup failed' }];
    const failed = await POST(request({ participantIds: [one] }));
    expect(failed.status).toBe(500);
  });

  it('returns a safe server error when guest authentication is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    mocks.singles.profiles[1] = null;
    mocks.lists.tournament_participants[0] = [entries[0]];

    const response = await POST(request({ participantIds: [one] }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not send the partner confirmation request. Please retry.',
    });
    expect(mocks.otp).not.toHaveBeenCalled();
  });

  it('does not let an unrelated member invite another team and uses event ID when slug is absent', async () => {
    mocks.singles.profiles[0] = { role: 'member', application_status: 'approved' };
    mocks.singles.events[0] = {
      slug: null,
      title: 'Summer Open',
      created_by: 'someone-else',
      organizer_id: null,
    };
    mocks.lists.tournament_participants[0] = [entries[0]];
    mocks.lists.tournament_pairs = [[]];
    const forbidden = await POST(request({ participantIds: [one] }));
    expect(forbidden.status).toBe(403);

    configureManagerPair();
    mocks.lists.tournament_participants[0] = [entries[0]];
    mocks.singles.profiles[1] = null;
    mocks.lists.tournament_pairs = [[]];
    mocks.singles.events[0] = {
      slug: null,
      title: 'Summer Open',
      created_by: 'organizer-1',
      organizer_id: 'organizer-1',
    };
    const managerResponse = await POST(request({ participantIds: [one] }));
    expect(managerResponse.status).toBe(200);
    expect(mocks.otp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining('next=%2Fevents%2Fevent-1%3Fconfirm_partner%3D'),
        }),
      }),
    );
  });

  it('uses a generic inviter name when a manager resends an unpaired member invitation', async () => {
    mocks.lists.tournament_participants[0] = [entries[0]];
    mocks.lists.tournament_pairs = [[]];

    const response = await POST(request({ participantIds: [one] }));

    expect(response.status).toBe(200);
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Confirm your place with A tournament participant',
      }),
    );
    expect(mocks.email.mock.calls[0][0].html).toContain('A tournament participant has listed you');
  });
});
