import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  data: {} as Record<string, unknown>,
  errors: {} as Record<string, { message: string }>,
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: mocks.rpc,
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { GET as tournamentPaymentStatusGet } from '@/app/api/events/[eventId]/tournament-payment-status/route';
import { GET as pairPaymentStatusGet } from '@/app/api/tournaments/[eventId]/pair-payment-status/route';

const eventId = '11111111-1111-4111-8111-111111111111';
const context = { params: { eventId } };

function queryResult(table: string, filters: Record<string, unknown>) {
  const operation =
    table === 'tournament_participants'
      ? filters.user_id
        ? 'own'
        : filters.id_ids
          ? 'partner'
          : 'other'
      : 'default';
  return {
    data: mocks.data[`${table}.${operation}`] ?? mocks.data[table] ?? null,
    error: mocks.errors[`${table}.${operation}`] ?? mocks.errors[table] ?? null,
  };
}

function serviceClient() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        neq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        in: (column: string, value: unknown) => {
          filters[`${column}_ids`] = value;
          return query;
        },
        maybeSingle: async () => queryResult(table, filters),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(queryResult(table, filters)).then(resolve, reject),
      };
      return query;
    },
  };
}

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.data = {};
  mocks.errors = {};
  mocks.createClient.mockReset().mockImplementation(serviceClient);
  mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/events/[eventId]/tournament-payment-status', () => {
  it('validates the event, requires a member, and checks server configuration', async () => {
    expect(
      (
        await tournamentPaymentStatusGet(new Request('https://club.test'), {
          params: { eventId: 'bad' },
        })
      ).status,
    ).toBe(400);
    mocks.user = null;
    expect(
      (await tournamentPaymentStatusGet(new Request('https://club.test'), context)).status,
    ).toBe(401);
    mocks.user = { id: 'member-1' };
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(
      (await tournamentPaymentStatusGet(new Request('https://club.test'), context)).status,
    ).toBe(503);
  });

  it('returns safe event and participant lookup errors', async () => {
    mocks.errors.events = { message: 'database details' };
    const failedEvent = await tournamentPaymentStatusGet(new Request('https://club.test'), context);
    expect(failedEvent.status).toBe(500);
    expect(await failedEvent.json()).toEqual({ error: 'Could not load tournament.' });

    mocks.errors = {};
    mocks.data.events = { id: eventId, event_type: 'social' };
    const notTournament = await tournamentPaymentStatusGet(
      new Request('https://club.test'),
      context,
    );
    expect(notTournament.status).toBe(404);

    mocks.data.events = { id: eventId, event_type: 'tournament' };
    mocks.errors['tournament_participants.own'] = { message: 'database details' };
    const failedParticipants = await tournamentPaymentStatusGet(
      new Request('https://club.test'),
      context,
    );
    expect(failedParticipants.status).toBe(500);
    expect(await failedParticipants.json()).toEqual({ error: 'Could not load payment status.' });
  });

  it('returns an empty status map without querying pairs for an event with no entries', async () => {
    mocks.data.events = { id: eventId, event_type: 'tournament' };
    mocks.data['tournament_participants.own'] = [];
    const response = await tournamentPaymentStatusGet(new Request('https://club.test'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paymentStatusById: {} });
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  });

  it('collects partner statuses for both pair sides and excludes the caller', async () => {
    mocks.data.events = { id: eventId, event_type: 'tournament' };
    mocks.data['tournament_participants.own'] = [
      { id: 'own-1', payment_status: 'paid' },
      { id: 'own-2', payment_status: 'pending' },
    ];
    mocks.data.tournament_pairs = [
      { player_one_id: 'own-1', player_two_id: 'partner-1', status: 'registered' },
      { player_one_id: 'partner-2', player_two_id: 'own-2', status: 'registered' },
      { player_one_id: 'own-1', player_two_id: 'own-2', status: 'registered' },
    ];
    mocks.data['tournament_participants.partner'] = [
      { id: 'partner-1', payment_status: 'paid' },
      { id: 'partner-2', payment_status: 'failed' },
    ];

    const response = await tournamentPaymentStatusGet(new Request('https://club.test'), context);
    expect(await response.json()).toEqual({
      paymentStatusById: {
        'own-1': 'paid',
        'own-2': 'pending',
        'partner-1': 'paid',
        'partner-2': 'failed',
      },
    });
  });

  it('returns a safe error when pair or partner statuses cannot be loaded', async () => {
    mocks.data.events = { id: eventId, event_type: 'tournament' };
    mocks.data['tournament_participants.own'] = [{ id: 'own-1', payment_status: 'pending' }];
    mocks.errors.tournament_pairs = { message: 'database details' };
    const failedPairs = await tournamentPaymentStatusGet(new Request('https://club.test'), context);
    expect(await failedPairs.json()).toEqual({ error: 'Could not load team payment status.' });

    mocks.errors = {};
    mocks.data.tournament_pairs = [
      { player_one_id: 'own-1', player_two_id: 'partner-1', status: 'registered' },
    ];
    mocks.errors['tournament_participants.partner'] = { message: 'database details' };
    const failedPartner = await tournamentPaymentStatusGet(
      new Request('https://club.test'),
      context,
    );
    expect(await failedPartner.json()).toEqual({ error: 'Could not load partner payment status.' });
  });
});

describe('GET /api/tournaments/[eventId]/pair-payment-status', () => {
  it('validates the event and requires authentication', async () => {
    expect(
      (
        await pairPaymentStatusGet(new Request('https://club.test'), {
          params: { eventId: 'bad' },
        })
      ).status,
    ).toBe(400);
    mocks.user = null;
    const unauthorized = await pairPaymentStatusGet(new Request('https://club.test'), context);
    expect(unauthorized.status).toBe(401);
  });

  it('returns partner status data and handles RPC errors safely', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const success = await pairPaymentStatusGet(new Request('https://club.test'), context);
    expect(await success.json()).toEqual({ data: [] });
    expect(success.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('event_tournament_pair_payment_status', {
      p_event_id: eventId,
    });

    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private error' } });
    const failed = await pairPaymentStatusGet(new Request('https://club.test'), context);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Could not retrieve partner payment status.' });
  });
});
