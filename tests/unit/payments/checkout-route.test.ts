import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  createPendingPayment: vi.fn(),
  getStripeClient: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/payments/server', () => ({ createPendingPayment: mocks.createPendingPayment }));
vi.mock('@/lib/payments/stripe', () => ({ getStripeClient: mocks.getStripeClient }));

import { POST } from '@/app/api/payments/checkout/route';

function request(body: unknown) {
  return new Request('http://localhost/api/payments/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('payment checkout endpoint', () => {
  beforeEach(() => vi.resetAllMocks());

  it('requires an authenticated user before creating a payment', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(request({ purpose: 'membership' }));
    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createPendingPayment).not.toHaveBeenCalled();
  });

  it('rejects unsupported payment purposes before accessing the database', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'member-1', email: 'member@example.test' } },
    });
    const response = await POST(request({ purpose: 'donation' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported payment purpose.' });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createPendingPayment).not.toHaveBeenCalled();
  });
});
