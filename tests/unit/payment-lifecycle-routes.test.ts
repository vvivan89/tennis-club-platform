import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string; application_status: string },
  rows: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  rpc: vi.fn(),
  getStripeClient: vi.fn(),
  refundsCreate: vi.fn(),
  sessionRetrieve: vi.fn(),
  sessionExpire: vi.fn(),
  paymentIntentRetrieve: vi.fn(),
  chargeRetrieve: vi.fn(),
  createPaymentServiceClient: vi.fn(),
}));

function resultFor(table: string, operation: string) {
  const error = mocks.errors[`${table}.${operation}`] ?? null;
  const data =
    table === 'profiles'
      ? mocks.profile
      : (mocks.rows[`${table}.${operation}`] ?? mocks.rows[table] ?? null);
  return { data, error };
}

function queryFor(table: string) {
  let operation = 'select';
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    update: () => {
      operation = 'update';
      return query;
    },
    upsert: () => {
      operation = 'upsert';
      return query;
    },
    maybeSingle: async () => resultFor(table, operation),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor(table, operation)).then(resolve, reject),
  };
  return query;
}

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => queryFor(table),
  }),
}));
vi.mock('@/lib/payments/server', () => ({
  createPaymentServiceClient: mocks.createPaymentServiceClient,
}));
vi.mock('@/lib/payments/stripe', () => ({ getStripeClient: mocks.getStripeClient }));

import { GET as statusGet } from '@/app/api/payments/status/route';
import { POST as cancelPost } from '@/app/api/payments/cancel/route';
import { POST as refundPost } from '@/app/api/admin/payments/refund/route';

function request(url: string, body?: unknown) {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const payment = {
  id: 'payment-1',
  user_id: 'member-1',
  purpose: 'event_registration',
  business_record_id: 'registration-1',
  amount_minor: 2500,
  currency: 'cad',
  status: 'succeeded',
  refunded_amount_minor: 0,
  created_at: '2026-01-01T00:00:00Z',
  succeeded_at: '2026-01-01T00:01:00Z',
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: 'pi-1',
};

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.rows = {};
  mocks.errors = {};
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.refundsCreate.mockReset().mockResolvedValue({
    id: 'refund-1',
    amount: 500,
    currency: 'cad',
    status: 'succeeded',
    reason: 'requested_by_customer',
  });
  mocks.sessionRetrieve.mockReset().mockResolvedValue({ status: 'open', url: 'https://checkout.test' });
  mocks.sessionExpire.mockReset().mockResolvedValue({});
  mocks.paymentIntentRetrieve.mockReset().mockResolvedValue({ latest_charge: 'ch-1' });
  mocks.chargeRetrieve.mockReset().mockResolvedValue({
    amount_refunded: 500,
    refunds: { data: [] },
  });
  mocks.createPaymentServiceClient.mockReset().mockImplementation(() => ({
    from: (table: string) => queryFor(table),
    rpc: mocks.rpc,
  }));
  mocks.getStripeClient.mockReset().mockReturnValue({
    checkout: { sessions: { retrieve: mocks.sessionRetrieve, expire: mocks.sessionExpire } },
    refunds: { create: mocks.refundsCreate },
    paymentIntents: { retrieve: mocks.paymentIntentRetrieve },
    charges: { retrieve: mocks.chargeRetrieve },
  });
});

describe('payment status endpoint', () => {
  it('requires authentication and a valid reference', async () => {
    mocks.user = null;
    expect((await statusGet(request('https://club.test/api/payments/status?payment_id=bad'))).status)
      .toBe(401);
    mocks.user = { id: 'member-1' };
    const invalid = await statusGet(request('https://club.test/api/payments/status?payment_id=bad'));
    expect(invalid.status).toBe(400);
    expect(mocks.createPaymentServiceClient).not.toHaveBeenCalled();
  });

  it('returns not-found for a missing payment and an empty result for a missing registration payment', async () => {
    const missing = await statusGet(
      request('https://club.test/api/payments/status?payment_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(missing.status).toBe(404);
    const registration = await statusGet(
      request('https://club.test/api/payments/status?registration_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(registration.status).toBe(200);
    expect(await registration.json()).toEqual({ payment: null, fulfilled: false });
  });

  it('reports a succeeded event registration as fulfilled only when its record is paid', async () => {
    mocks.rows.payments = payment;
    mocks.rows.registrations = { status: 'confirmed', payment_status: 'paid' };
    const response = await statusGet(
      request('https://club.test/api/payments/status?registration_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      payment: { id: 'payment-1', status: 'succeeded' },
      fulfilled: true,
      checkoutUrl: null,
    });
  });

  it('checks individual and family membership fulfillment independently', async () => {
    mocks.rows.payments = {
      ...payment,
      purpose: 'membership',
      business_record_id: 'membership-1',
    };
    mocks.rows.memberships = { status: 'active', payment_status: 'paid' };
    const individual = await statusGet(
      request('https://club.test/api/payments/status?payment_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(await individual.json()).toMatchObject({ fulfilled: true });

    mocks.rows.payments = {
      ...payment,
      purpose: 'membership',
      business_record_id: 'family:family-1',
    };
    mocks.rows.membership_families = { paid_at: '2026-04-01', payment_id: 'payment-1' };
    const family = await statusGet(
      request('https://club.test/api/payments/status?payment_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(await family.json()).toMatchObject({ fulfilled: true });
  });

  it('returns an open checkout URL for a pending registration', async () => {
    mocks.rows.payments = {
      ...payment,
      status: 'pending',
      stripe_checkout_session_id: 'cs_open',
    };
    mocks.sessionRetrieve.mockResolvedValue({ status: 'open', url: 'https://checkout.test/pay' });
    const response = await statusGet(
      request('https://club.test/api/payments/status?registration_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(await response.json()).toMatchObject({ checkoutUrl: 'https://checkout.test/pay' });
  });

  it('reconciles a matching completed paid checkout and fulfills its registration', async () => {
    const checkoutPayment = {
      ...payment,
      status: 'pending',
      stripe_checkout_session_id: 'cs_paid',
    };
    mocks.rows.payments = checkoutPayment;
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs_paid',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      amount_total: 2500,
      currency: 'cad',
      client_reference_id: 'payment-1',
      payment_intent: 'pi-paid',
      metadata: {
        pctc_payment_id: 'payment-1',
        pctc_purpose: 'event_registration',
        pctc_business_record_id: 'registration-1',
        pctc_user_id: 'member-1',
      },
    });
    mocks.paymentIntentRetrieve.mockResolvedValue({
      id: 'pi-paid',
      status: 'succeeded',
      amount: 2500,
      currency: 'cad',
      metadata: {
        pctc_payment_id: 'payment-1',
        pctc_purpose: 'event_registration',
        pctc_business_record_id: 'registration-1',
        pctc_user_id: 'member-1',
      },
    });
    mocks.rows.registrations = { status: 'confirmed', payment_status: 'paid' };
    const response = await statusGet(
      request('https://club.test/api/payments/status?registration_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ payment: { status: 'succeeded' }, fulfilled: true });
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', { p_payment_id: 'payment-1' });
  });

  it('leaves incomplete checkout sessions unchanged and rejects mismatched paid sessions', async () => {
    mocks.rows.payments = { ...payment, status: 'pending', stripe_checkout_session_id: 'cs_open' };
    mocks.sessionRetrieve.mockResolvedValue({ status: 'open', payment_status: 'unpaid' });
    const pending = await statusGet(
      request('https://club.test/api/payments/status?session_id=cs_open'),
    );
    expect(await pending.json()).toMatchObject({ payment: { status: 'pending' }, fulfilled: false });

    mocks.rows.payments = { ...payment, stripe_checkout_session_id: 'cs_wrong' };
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs_wrong',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      amount_total: 2500,
      currency: 'cad',
      client_reference_id: 'payment-1',
      payment_intent: 'pi-paid',
      metadata: { pctc_payment_id: 'different-payment' },
    });
    const mismatch = await statusGet(
      request('https://club.test/api/payments/status?session_id=cs_wrong'),
    );
    expect(mismatch.status).toBe(500);
    expect(await mismatch.json()).toEqual({ error: 'Could not retrieve payment status.' });
  });

  it('returns a safe server error when the payment query fails', async () => {
    mocks.errors['payments.select'] = { message: 'database detail' };
    const response = await statusGet(
      request('https://club.test/api/payments/status?payment_id=11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not retrieve payment status.' });
  });
});

describe('cancel payment endpoint', () => {
  it('requires authentication and a registration ID', async () => {
    mocks.user = null;
    expect((await cancelPost(request('https://club.test/api/payments/cancel', {}))).status).toBe(401);
    mocks.user = { id: 'member-1' };
    const invalid = await cancelPost(request('https://club.test/api/payments/cancel', {}));
    expect(invalid.status).toBe(400);
  });

  it('does nothing when no pending payment exists', async () => {
    const response = await cancelPost(
      request('https://club.test/api/payments/cancel', { registrationId: 'registration-1' }),
    );
    expect(await response.json()).toEqual({ success: true, noPendingPayment: true });
  });

  it('refuses a completed checkout and expires an open checkout before canceling', async () => {
    mocks.rows.payments = {
      id: 'payment-1',
      status: 'pending',
      stripe_checkout_session_id: 'cs-1',
    };
    mocks.sessionRetrieve.mockResolvedValue({ status: 'complete' });
    const completed = await cancelPost(
      request('https://club.test/api/payments/cancel', { registrationId: 'registration-1' }),
    );
    expect(completed.status).toBe(409);

    mocks.sessionRetrieve.mockResolvedValue({ id: 'cs-1', status: 'open' });
    const canceled = await cancelPost(
      request('https://club.test/api/payments/cancel', { registrationId: 'registration-1' }),
    );
    expect(canceled.status).toBe(200);
    expect(mocks.sessionExpire).toHaveBeenCalledWith('cs-1');
  });

  it('returns a safe error when payment lookup fails', async () => {
    mocks.errors['payments.select'] = { message: 'database detail' };
    const response = await cancelPost(
      request('https://club.test/api/payments/cancel', { registrationId: 'registration-1' }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Could not cancel') });
  });
});

describe('admin refund endpoint', () => {
  it('requires approved admin access and a payment ID', async () => {
    mocks.user = null;
    expect((await refundPost(request('https://club.test/api/admin/payments/refund', {}))).status)
      .toBe(401);
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    expect((await refundPost(request('https://club.test/api/admin/payments/refund', {}))).status)
      .toBe(403);
    mocks.profile = { role: 'admin', application_status: 'approved' };
    expect((await refundPost(request('https://club.test/api/admin/payments/refund', {}))).status)
      .toBe(400);
  });

  it('validates payment state, amount, and idempotency key before calling Stripe', async () => {
    const body = { paymentId: 'payment-1', idempotencyKey: 'key-1' };
    expect(
      (await refundPost(request('https://club.test/api/admin/payments/refund', body))).status,
    ).toBe(404);

    mocks.rows.payments = { ...payment, status: 'pending' };
    expect(
      (await refundPost(request('https://club.test/api/admin/payments/refund', body))).status,
    ).toBe(409);

    mocks.rows.payments = { ...payment, status: 'succeeded' };
    expect(
      (
        await refundPost(
          request('https://club.test/api/admin/payments/refund', {
            ...body,
            amountMinor: 2501,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await refundPost(
          request('https://club.test/api/admin/payments/refund', {
            paymentId: 'payment-1',
            amountMinor: 500,
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });

  it('creates a partial refund with an idempotency key and synchronizes Stripe records', async () => {
    mocks.rows.payments = payment;
    mocks.chargeRetrieve.mockResolvedValue({ amount_refunded: 500, refunds: { data: [] } });
    const response = await refundPost(
      request('https://club.test/api/admin/payments/refund', {
        paymentId: 'payment-1',
        amountMinor: 500,
        reason: 'duplicate',
        idempotencyKey: ' retry-1 ',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      refundId: 'refund-1',
      status: 'succeeded',
      amountMinor: 500,
      currency: 'cad',
    });
    expect(mocks.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, reason: 'duplicate' }),
      { idempotencyKey: 'pctc-refund:payment-1:retry-1' },
    );
    expect(mocks.paymentIntentRetrieve).toHaveBeenCalledWith('pi-1', { expand: ['latest_charge'] });
    expect(mocks.chargeRetrieve).toHaveBeenCalledWith('ch-1', { expand: ['refunds.data'] });
  });

  it('returns a safe error if Stripe rejects the refund', async () => {
    mocks.rows.payments = payment;
    mocks.refundsCreate.mockRejectedValue(new Error('private Stripe details'));
    const response = await refundPost(
      request('https://club.test/api/admin/payments/refund', {
        paymentId: 'payment-1',
        idempotencyKey: 'key-1',
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not request refund. Check payment status and Stripe configuration.',
    });
  });
});