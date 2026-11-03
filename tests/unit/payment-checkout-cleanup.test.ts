import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canceledPaymentPatch,
  expireCheckoutSession,
  markPaymentCanceled,
  markPaymentSucceeded,
  removeProvisionalGuestEntries,
} from '@/lib/payments/checkout-cleanup';

const stripeMocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  expire: vi.fn(),
}));
vi.mock('@/lib/payments/stripe', () => ({
  getStripeClient: () => ({
    checkout: { sessions: { retrieve: stripeMocks.retrieve, expire: stripeMocks.expire } },
  }),
}));

function database(results: Record<string, Array<{ data?: unknown; error?: unknown }>>) {
  const calls: Array<{ table: string; operation: string; payload?: unknown }> = [];
  return {
    calls,
    client: {
      from: (table: string) => {
        let operation = 'select';
        let payload: unknown;
        const next = () => results[`${table}.${operation}`]?.shift() ?? { data: null, error: null };
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          update: (value: unknown) => {
            operation = 'update';
            payload = value;
            calls.push({ table, operation, payload });
            return query;
          },
          delete: () => {
            operation = 'delete';
            calls.push({ table, operation });
            return query;
          },
          maybeSingle: async () => next(),
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(next()).then(resolve, reject),
        };
        return query;
      },
    },
  };
}

const messages = {
  inspectPairs: 'pair lookup failed',
  inspectEntries: 'entry lookup failed',
  removePairs: 'pair deletion failed',
  removeEntries: 'entry deletion failed',
};
const asDb = (value: ReturnType<typeof database>['client']) =>
  value as unknown as Parameters<typeof markPaymentSucceeded>[0];

afterEach(() => vi.clearAllMocks());

describe('payment checkout cleanup helpers', () => {
  it('builds a timestamped canceled status patch and marks only open payments succeeded', async () => {
    const patch = canceledPaymentPatch();
    expect(patch).toMatchObject({ status: 'canceled' });
    expect(patch.canceled_at).toBe(patch.updated_at);

    const db = database({ 'payments.update': [{ data: { id: 'payment-1' }, error: null }] });
    const result = await markPaymentSucceeded(asDb(db.client), 'payment-1', 'pi-1');
    expect(result.updated).toBe(true);
    expect(result.error).toBeNull();
    expect(db.calls[0].payload).toMatchObject({
      status: 'succeeded',
      stripe_payment_intent_id: 'pi-1',
    });

    const unchanged = database({
      'payments.update': [{ data: null, error: { message: 'write failed' } }],
    });
    expect(await markPaymentSucceeded(asDb(unchanged.client), 'payment-2', 'pi-2')).toMatchObject({
      updated: false,
      error: { message: 'write failed' },
    });
  });

  it('expires open sessions, preserves completed sessions and verifies final state', async () => {
    stripeMocks.retrieve.mockResolvedValueOnce({ id: 'cs-1', status: 'complete' });
    expect(await expireCheckoutSession('cs-1')).toBe('complete');
    expect(stripeMocks.expire).not.toHaveBeenCalled();

    stripeMocks.retrieve.mockResolvedValueOnce({ id: 'cs-2', status: 'open' });
    expect(await expireCheckoutSession('cs-2')).toBe('expired');
    expect(stripeMocks.expire).toHaveBeenCalledWith('cs-2');

    stripeMocks.retrieve
      .mockResolvedValueOnce({ id: 'cs-3', status: 'expired' })
      .mockResolvedValueOnce({ id: 'cs-3', status: 'expired' });
    expect(await expireCheckoutSession('cs-3', { verify: true })).toBe('expired');
    stripeMocks.retrieve
      .mockResolvedValueOnce({ id: 'cs-4', status: 'open' })
      .mockResolvedValueOnce({ id: 'cs-4', status: 'open' });
    expect(await expireCheckoutSession('cs-4', { verify: true })).toBe('uncertain');
  });

  it('marks payments canceled and surfaces database failures with the supplied message', async () => {
    await expect(
      markPaymentCanceled(
        asDb(database({ 'payments.update': [{ error: null }] }).client),
        'p1',
        'cancel failed',
      ),
    ).resolves.toBeUndefined();
    await expect(
      markPaymentCanceled(
        asDb(database({ 'payments.update': [{ error: { message: 'db failed' } }] }).client),
        'p1',
        'cancel failed',
      ),
    ).rejects.toThrow('cancel failed');
  });

  it('removes only provisional guest entries and their pairs', async () => {
    const db = database({
      'tournament_pairs.select': [
        { data: [{ player_one_id: 'guest-1', player_two_id: 'member-1' }], error: null },
        { data: [{ player_one_id: 'guest-2', player_two_id: 'guest-1' }], error: null },
      ],
      'tournament_participants.select': [
        {
          data: [
            { id: 'guest-1', user_id: null, status: 'provisional' },
            { id: 'member-1', user_id: 'user-1', status: 'registered' },
            { id: 'guest-2', user_id: null, status: 'registered' },
          ],
          error: null,
        },
      ],
      'tournament_pairs.delete': [{ error: null }, { error: null }],
      'tournament_participants.delete': [{ error: null }],
    });
    await expect(
      removeProvisionalGuestEntries(asDb(db.client), ['guest-1'], messages),
    ).resolves.toBeUndefined();
    expect(db.calls.filter((call) => call.operation === 'delete')).toHaveLength(3);
  });

  it('reports pair/entry lookup and deletion errors', async () => {
    await expect(
      removeProvisionalGuestEntries(
        asDb(
          database({
            'tournament_pairs.select': [
              { data: [], error: { message: 'lookup' } },
              { data: [], error: null },
            ],
          }).client,
        ),
        ['guest-1'],
        messages,
      ),
    ).rejects.toThrow(messages.inspectPairs);

    await expect(
      removeProvisionalGuestEntries(
        asDb(
          database({
            'tournament_pairs.select': [
              { data: [], error: null },
              { data: [], error: null },
            ],
            'tournament_participants.select': [{ data: [], error: { message: 'lookup' } }],
          }).client,
        ),
        ['guest-1'],
        messages,
      ),
    ).rejects.toThrow(messages.inspectEntries);

    const pairDeleteFailure = database({
      'tournament_pairs.select': [
        { data: [], error: null },
        { data: [], error: null },
      ],
      'tournament_participants.select': [
        { data: [{ id: 'g', user_id: null, status: 'provisional' }], error: null },
      ],
      'tournament_pairs.delete': [{ error: { message: 'delete' } }, { error: null }],
    });
    await expect(
      removeProvisionalGuestEntries(asDb(pairDeleteFailure.client), ['g'], messages),
    ).rejects.toThrow(messages.removePairs);

    await expect(
      removeProvisionalGuestEntries(
        asDb(
          database({
            'tournament_pairs.select': [
              { data: [], error: null },
              { data: [], error: null },
            ],
            'tournament_participants.select': [
              { data: [{ id: 'g', user_id: null, status: 'provisional' }], error: null },
            ],
            'tournament_pairs.delete': [{ error: null }, { error: null }],
            'tournament_participants.delete': [{ error: { message: 'delete' } }],
          }).client,
        ),
        ['g'],
        messages,
      ),
    ).rejects.toThrow(messages.removeEntries);
  });
});
