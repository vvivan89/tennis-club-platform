import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminContext: vi.fn(),
  paymentClient: vi.fn(),
  filters: [] as Array<[string, unknown]>,
  count: 0,
  error: null as { message: string } | null,
}));

vi.mock('@/lib/admin-api-auth', () => ({
  getApprovedAdminContext: mocks.adminContext,
}));
vi.mock('@/lib/payments/server', () => ({
  createPaymentServiceClient: mocks.paymentClient,
}));

import { GET } from '@/app/api/admin/payments/pending-interac-count/route';

function makePaymentClient() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((key: string, value: unknown) => {
      mocks.filters.push([key, value]);
      return query;
    }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ count: mocks.count, error: mocks.error }).then(resolve),
  };
  return { from: vi.fn(() => query) };
}

beforeEach(() => {
  mocks.adminContext.mockReset().mockResolvedValue({ response: null });
  mocks.paymentClient.mockReset().mockReturnValue(makePaymentClient());
  mocks.filters = [];
  mocks.count = 1;
  mocks.error = null;
});

describe('GET /api/admin/payments/pending-interac-count', () => {
  it('returns the admin-only count of Interac requests awaiting review without caching', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1 });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.filters).toEqual([
      ['provider', 'interac'],
      ['status', 'pending'],
      ['manual_review_status', 'submitted'],
    ]);
  });

  it('returns the authorization response without querying payments', async () => {
    const denied = Response.json({ error: 'Administrator access required.' }, { status: 403 });
    mocks.adminContext.mockResolvedValueOnce({ response: denied });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.paymentClient).not.toHaveBeenCalled();
  });

  it('returns an error when the count query fails', async () => {
    mocks.error = { message: 'database unavailable' };

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not load pending Interac payment count.',
    });
  });
});
