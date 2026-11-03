import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: mocks.rpc,
  }),
}));

import { GET } from '@/app/api/tournaments/[eventId]/pair-payment-status/route';

function get(eventId: string) {
  return GET(new Request('https://club.test'), { params: Promise.resolve({ eventId }) });
}

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ paid: true }], error: null });
});
afterEach(() => vi.clearAllMocks());

describe('GET tournament pair payment status', () => {
  it('validates the event ID and requires sign-in', async () => {
    expect((await get('bad-id')).status).toBe(400);
    mocks.user = null;
    expect((await get('22222222-2222-4222-8222-222222222222')).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns the private pair payment status from the RPC', async () => {
    const response = await get('22222222-2222-4222-8222-222222222222');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ paid: true }] });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('event_tournament_pair_payment_status', {
      p_event_id: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('normalizes empty data and reports RPC failures', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await (await get('22222222-2222-4222-8222-222222222222')).json()).toEqual({ data: [] });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } });
    const failed = await get('22222222-2222-4222-8222-222222222222');
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Could not retrieve partner payment status.' });
  });
});
