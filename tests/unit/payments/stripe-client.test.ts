import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ constructedWith: [] as string[] }));

vi.mock('stripe', () => ({
  default: class StripeMock {
    constructor(secret: string) {
      mocks.constructedWith.push(secret);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.constructedWith = [];
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_unit');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_unit');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Stripe client configuration', () => {
  it('creates and caches a Stripe client and returns the webhook secret', async () => {
    const { getStripeClient, getStripeWebhookSecret } = await import('@/lib/payments/stripe');
    const first = getStripeClient();
    const second = getStripeClient();
    expect(first).toBe(second);
    expect(mocks.constructedWith).toEqual(['sk_test_unit']);
    expect(getStripeWebhookSecret()).toBe('whsec_unit');
  });

  it('validates configuration before constructing a client', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { getStripeClient } = await import('@/lib/payments/stripe');
    expect(() => getStripeClient()).toThrow('STRIPE_SECRET_KEY is required');
    expect(mocks.constructedWith).toEqual([]);
  });
});
