import { describe, expect, it } from 'vitest';
import {
  assertPaymentTransition,
  calculateRefundState,
  canTransitionPayment,
  getStripeConfiguration,
  mapStripePaymentStatus,
  validatePaymentInput,
} from '@/lib/payments/core';

describe('payment input validation', () => {
  it('accepts integer minor units and normalizes currency', () => {
    expect(
      validatePaymentInput({ amountMinor: 1250, currency: 'CAD', purpose: 'membership' }),
    ).toEqual({ amountMinor: 1250, currency: 'cad', purpose: 'membership' });
  });

  it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN])(
    'rejects invalid amount %s',
    (amountMinor) => {
      expect(() =>
        validatePaymentInput({ amountMinor, currency: 'CAD', purpose: 'membership' }),
      ).toThrow(/amount/i);
    },
  );

  it('rejects malformed currency and unsupported purpose', () => {
    expect(() =>
      validatePaymentInput({ amountMinor: 100, currency: 'CAD$', purpose: 'membership' }),
    ).toThrow(/currency/i);
    expect(() =>
      validatePaymentInput({ amountMinor: 100, currency: 'CAD', purpose: 'donation' }),
    ).toThrow(/purpose/i);
  });
});

describe('payment lifecycle', () => {
  it('allows expected forward transitions and idempotent same-state updates', () => {
    expect(canTransitionPayment('pending', 'processing')).toBe(true);
    expect(canTransitionPayment('pending', 'pending')).toBe(true);
    expect(canTransitionPayment('succeeded', 'partially_refunded')).toBe(true);
    expect(canTransitionPayment('partially_refunded', 'refunded')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionPayment('canceled', 'succeeded')).toBe(false);
    expect(canTransitionPayment('refunded', 'succeeded')).toBe(false);
    expect(() => assertPaymentTransition('pending', 'refunded')).toThrow(/Invalid payment status/);
  });

  it('maps only supported Stripe payment intent events', () => {
    expect(mapStripePaymentStatus('payment_intent.succeeded', 'pending')).toBe('succeeded');
    expect(mapStripePaymentStatus('payment_intent.payment_failed', 'processing')).toBe('failed');
    expect(mapStripePaymentStatus('payment_intent.succeeded', 'canceled')).toBeNull();
    expect(mapStripePaymentStatus('customer.created', 'pending')).toBeNull();
  });
});

describe('refund reconciliation state', () => {
  it('tracks partial refunds using integer minor units', () => {
    expect(calculateRefundState('succeeded', 1000, 0, 250)).toEqual({
      status: 'partially_refunded',
      refundedAmountMinor: 250,
    });
  });

  it('recognizes full refunds and never regresses a reported refund total', () => {
    expect(calculateRefundState('partially_refunded', 1000, 250, 1000)).toEqual({
      status: 'refunded',
      refundedAmountMinor: 1000,
    });
    expect(calculateRefundState('refunded', 1000, 1000, 250)).toEqual({
      status: 'refunded',
      refundedAmountMinor: 1000,
    });
  });

  it('rejects refund totals outside the payment amount and ineligible states', () => {
    expect(() => calculateRefundState('succeeded', 1000, 0, 1200)).toThrow(
      /outside the payment amount/,
    );
    expect(() => calculateRefundState('pending', 1000, 0, 100)).toThrow(
      /cannot be marked refunded/,
    );
  });
});

describe('Stripe configuration', () => {
  const valid = {
    NODE_ENV: 'test' as const,
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
  };

  it('requires a Stripe secret key', () => {
    expect(() =>
      getStripeConfiguration({
        NODE_ENV: 'test',
        STRIPE_WEBHOOK_SECRET: valid.STRIPE_WEBHOOK_SECRET,
      }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('requires a valid Stripe secret-key mode and webhook secret', () => {
    expect(getStripeConfiguration(valid).mode).toBe('test');
    expect(() => getStripeConfiguration({ ...valid, STRIPE_SECRET_KEY: 'not-a-key' })).toThrow(
      /test-mode or live-mode/,
    );
    expect(() =>
      getStripeConfiguration({ NODE_ENV: 'test', STRIPE_SECRET_KEY: valid.STRIPE_SECRET_KEY }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
