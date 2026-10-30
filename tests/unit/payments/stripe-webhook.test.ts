import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  writes: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock('@/lib/payments/stripe', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
    paymentIntents: { retrieve: mocks.retrievePaymentIntent },
    charges: { retrieve: mocks.retrieveCharge },
  }),
  getStripeWebhookSecret: () => 'whsec_test',
}));
vi.mock('@/lib/payments/server', () => ({
  createPaymentServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { POST } from '@/app/api/webhooks/stripe/route';

function configureEvent(type: string, object: Record<string, unknown>) {
  mocks.constructEvent.mockReturnValue({
    id: `evt_${type.replaceAll('.', '_')}`,
    type,
    livemode: false,
    data: { object },
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'claim_stripe_webhook_event',
    error: null,
  }));
}

function configureStorage(
  payment: Record<string, unknown>,
  options: {
    latestPayment?: Record<string, unknown> | null;
    updateResult?: { data: unknown; error: unknown };
    refunds?: Array<Record<string, unknown>>;
  } = {},
) {
  let lookupCount = 0;
  mocks.from.mockImplementation((table: string) => {
    if (table === 'payments') {
      let operation = 'select';
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        update: (values: Record<string, unknown>) => {
          operation = 'update';
          mocks.writes.push({ table, values });
          return query;
        },
        maybeSingle: async () => {
          if (operation === 'update')
            return options.updateResult ?? { data: { id: payment.id }, error: null };
          const result = lookupCount++ === 0 ? payment : (options.latestPayment ?? null);
          return { data: result, error: null };
        },
      };
      return query;
    }
    if (table === 'payment_refunds') return { upsert: async () => ({ error: null }) };
    if (table === 'stripe_webhook_events')
      return { update: () => ({ eq: async () => ({ error: null }) }) };
    if (table === 'audit_logs') return { upsert: async () => ({ error: null }) };
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.retrieveCharge.mockResolvedValue({
    amount_refunded: 250,
    refunds: { data: options.refunds ?? [] },
  });
}

function request(signature?: string) {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: signature ? { 'stripe-signature': signature } : {},
    body: '{}',
  });
}

describe('Stripe webhook endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.writes = [];
  });

  it('rejects requests without a Stripe signature before accessing storage', async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures', async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const response = await POST(request('invalid'));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('acknowledges an event already claimed or processed without applying effects again', async () => {
    mocks.constructEvent.mockReturnValue({
      id: 'evt_duplicate',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: { object: { id: 'pi_test' } },
    });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await POST(request('valid-signature'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_stripe_webhook_event', {
      p_event_id: 'evt_duplicate',
      p_event_type: 'payment_intent.succeeded',
      p_livemode: false,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('ignores unsupported events and safely rejects a failed event claim', async () => {
    mocks.constructEvent.mockReturnValue({
      id: 'evt_ignored',
      type: 'customer.updated',
      livemode: false,
      data: { object: {} },
    });
    const ignored = await POST(request('valid-signature'));
    expect(await ignored.json()).toEqual({ received: true, ignored: true });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.constructEvent.mockReturnValue({
      id: 'evt_claim_failure',
      type: 'payment_intent.processing',
      livemode: false,
      data: { object: {} },
    });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'storage unavailable' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await POST(request('valid-signature'));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Could not safely claim webhook event.' });
  });

  it.each([
    ['payment_intent.processing', 'processing'],
    ['payment_intent.payment_failed', 'failed'],
    ['payment_intent.canceled', 'canceled'],
  ])('updates pending payments for %s events', async (eventType, nextStatus) => {
    const payment = {
      id: 'payment-transition',
      status: 'pending',
      amount_minor: 1250,
      currency: 'cad',
      stripe_payment_intent_id: null,
      last_stripe_event_id: null,
      purpose: 'membership',
      business_record_id: 'membership-1',
      user_id: 'user-1',
    };
    configureEvent(eventType, {
      id: 'pi-transition',
      amount: 1250,
      currency: 'cad',
      last_payment_error: eventType.endsWith('payment_failed') ? { code: 'card_declined' } : null,
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
    });
    configureStorage(payment);
    const response = await POST(request('valid-signature'));
    expect(response.status).toBe(200);
    expect(mocks.writes).toContainEqual({
      table: 'payments',
      values: expect.objectContaining({
        status: nextStatus,
        stripe_payment_intent_id: 'pi-transition',
      }),
    });
    if (eventType === 'payment_intent.payment_failed') {
      expect(mocks.writes[0]?.values).toMatchObject({
        failure_code: 'card_declined',
        failure_message: 'Payment failed. See the Stripe dashboard for diagnostic details.',
      });
    }
    expect(mocks.rpc).not.toHaveBeenCalledWith('fulfill_successful_payment', expect.anything());
  });

  it('cancels pending payments on checkout expiration and preserves a concurrent success', async () => {
    const payment = {
      id: 'payment-expired',
      status: 'pending',
      purpose: 'membership',
      business_record_id: 'membership-1',
      user_id: 'user-1',
      stripe_checkout_session_id: 'cs-expired',
    };
    const metadata = {
      pctc_purpose: payment.purpose,
      pctc_business_record_id: payment.business_record_id,
      pctc_user_id: payment.user_id,
    };
    configureEvent('checkout.session.expired', {
      id: 'cs-expired',
      metadata: { ...metadata, pctc_payment_id: payment.id },
    });
    configureStorage(payment);
    const canceled = await POST(request('valid-signature'));
    expect(canceled.status).toBe(200);

    configureEvent('checkout.session.expired', {
      id: 'cs-expired',
      metadata: { ...metadata, pctc_payment_id: payment.id },
    });
    configureStorage(payment, {
      updateResult: { data: null, error: null },
      latestPayment: { status: 'succeeded' },
    });
    const concurrentSuccess = await POST(request('valid-signature'));
    expect(concurrentSuccess.status).toBe(200);
  });

  it('accepts abandoned async checkouts without a PaymentIntent and stores charge refunds', async () => {
    const payment = {
      id: 'payment-event',
      status: 'succeeded',
      amount_minor: 1250,
      currency: 'cad',
      refunded_amount_minor: 0,
      stripe_payment_intent_id: 'pi-refund',
      purpose: 'membership',
      business_record_id: 'membership-1',
      user_id: 'user-1',
      stripe_checkout_session_id: 'cs-abandoned',
    };
    configureEvent('checkout.session.async_payment_failed', {
      id: 'cs-abandoned',
      payment_intent: null,
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
    });
    configureStorage(payment);
    const abandoned = await POST(request('valid-signature'));
    expect(abandoned.status).toBe(200);
    expect(mocks.retrievePaymentIntent).not.toHaveBeenCalled();

    configureEvent('charge.refunded', {
      id: 'ch-refund',
      payment_intent: 'pi-refund',
      amount: 1250,
      currency: 'cad',
    });
    configureStorage(payment, {
      refunds: [
        {
          id: 're-1',
          amount: 250,
          currency: 'cad',
          status: null,
          reason: null,
        },
      ],
    });
    const refunded = await POST(request('valid-signature'));
    expect(refunded.status).toBe(200);
    expect(mocks.retrieveCharge).toHaveBeenCalledWith('ch-refund', {
      expand: ['refunds.data'],
    });
    expect(mocks.writes).toContainEqual({
      table: 'payments',
      values: expect.objectContaining({
        status: 'partially_refunded',
        refunded_amount_minor: 250,
      }),
    });
  });

  it('fulfills the linked business record after a validated successful payment', async () => {
    mocks.retrievePaymentIntent.mockResolvedValue({ latest_charge: null });
    const payment = {
      id: 'payment-1',
      status: 'pending',
      amount_minor: 1250,
      currency: 'cad',
      stripe_payment_intent_id: null,
      last_stripe_event_id: null,
      purpose: 'membership',
      business_record_id: 'membership-1',
      user_id: 'user-1',
    };
    mocks.constructEvent.mockReturnValue({
      id: 'evt_success',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: {
        object: {
          id: 'pi_success',
          amount: 1250,
          currency: 'cad',
          last_payment_error: null,
          metadata: {
            pctc_payment_id: payment.id,
            pctc_purpose: payment.purpose,
            pctc_business_record_id: payment.business_record_id,
            pctc_user_id: payment.user_id,
          },
        },
      },
    });
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'claim_stripe_webhook_event',
      error: null,
    }));
    const lookup = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: payment, error: null }),
    };
    const update = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: payment.id }, error: null }),
    };
    const eventUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const auditUpsert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'payments') return { select: () => lookup, update: () => update };
      if (table === 'stripe_webhook_events') return { update: () => eventUpdate };
      if (table === 'audit_logs') return { upsert: auditUpsert };
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await POST(request('valid-signature'));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: payment.id,
    });
    expect(update.eq).toHaveBeenCalledWith('status', 'pending');
    expect(auditUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.succeeded' }),
      {
        onConflict: 'idempotency_key',
        ignoreDuplicates: true,
      },
    );
  });

  it('reconciles a completed paid Checkout Session when Stripe sends the session event', async () => {
    const payment = {
      id: 'payment-session',
      status: 'pending',
      amount_minor: 2500,
      currency: 'cad',
      stripe_payment_intent_id: null,
      last_stripe_event_id: null,
      purpose: 'event_registration',
      business_record_id: 'registration-1',
      user_id: 'user-1',
      stripe_checkout_session_id: 'cs_test_paid',
    };
    const metadata = {
      pctc_payment_id: payment.id,
      pctc_purpose: payment.purpose,
      pctc_business_record_id: payment.business_record_id,
      pctc_user_id: payment.user_id,
    };
    mocks.constructEvent.mockReturnValue({
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_paid',
          mode: 'payment',
          status: 'complete',
          payment_status: 'paid',
          amount_total: 2500,
          currency: 'cad',
          client_reference_id: payment.id,
          payment_intent: 'pi_checkout_paid',
          metadata,
        },
      },
    });
    mocks.retrievePaymentIntent.mockResolvedValue({
      id: 'pi_checkout_paid',
      status: 'succeeded',
      amount: 2500,
      currency: 'cad',
      last_payment_error: null,
      metadata,
    });
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'claim_stripe_webhook_event',
      error: null,
    }));
    const lookup = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: payment, error: null }),
    };
    const update = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: payment.id }, error: null }),
    };
    const eventUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const auditUpsert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'payments') return { select: () => lookup, update: () => update };
      if (table === 'stripe_webhook_events') return { update: () => eventUpdate };
      if (table === 'audit_logs') return { upsert: auditUpsert };
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await POST(request('valid-signature'));
    expect(response.status).toBe(200);
    expect(mocks.retrievePaymentIntent).toHaveBeenCalledWith('pi_checkout_paid');
    expect(update.eq).toHaveBeenCalledWith('status', 'pending');
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: payment.id,
    });
  });

  it('accepts a completed but unpaid Checkout Session while waiting for asynchronous settlement', async () => {
    const payment = {
      id: 'payment-async',
      status: 'pending',
      amount_minor: 2500,
      currency: 'cad',
      stripe_payment_intent_id: null,
      purpose: 'event_registration',
      business_record_id: 'registration-async',
      user_id: 'user-1',
      stripe_checkout_session_id: 'cs-async',
    };
    configureEvent('checkout.session.completed', {
      id: 'cs-async',
      mode: 'payment',
      status: 'complete',
      payment_status: 'unpaid',
      amount_total: 2500,
      currency: 'cad',
      client_reference_id: payment.id,
      payment_intent: null,
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
    });
    configureStorage(payment);

    const response = await POST(request('valid-signature'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.retrievePaymentIntent).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
  });

  it('replays a succeeded intent idempotently and writes an audit only for its last event', async () => {
    const eventId = 'evt_payment_intent_processing';
    const payment = {
      id: 'payment-already-succeeded',
      status: 'succeeded',
      amount_minor: 1250,
      currency: 'cad',
      stripe_payment_intent_id: 'pi-already-succeeded',
      last_stripe_event_id: eventId,
      purpose: 'membership',
      business_record_id: 'membership-1',
      user_id: 'user-1',
    };
    configureEvent('payment_intent.processing', {
      id: 'pi-already-succeeded',
      amount: 1250,
      currency: 'cad',
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
    });
    configureStorage(payment);
    mocks.retrievePaymentIntent.mockResolvedValue({ latest_charge: null });

    const response = await POST(request('valid-signature'));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: payment.id,
    });
    expect(mocks.writes).toEqual([]);
  });

  it('marks processing failures for retry and records a deduplicated audit action', async () => {
    mocks.constructEvent.mockReturnValue({
      id: 'evt_retry',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: { object: { id: 'pi_test', metadata: {} } },
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const auditUpsert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'stripe_webhook_events') return { update: () => ({ eq: updateEq }) };
      if (table === 'audit_logs') return { upsert: auditUpsert };
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await POST(request('valid-signature'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Webhook processing failed; retry is safe.' });
    expect(updateEq).toHaveBeenCalledWith('stripe_event_id', 'evt_retry');
    expect(auditUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stripe.webhook_processing_failed',
        outcome: 'failure',
        idempotency_key: 'stripe:evt_retry:processing_failed',
      }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });
});
