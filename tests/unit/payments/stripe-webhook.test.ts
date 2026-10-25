import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/payments/stripe', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
    paymentIntents: { retrieve: mocks.retrievePaymentIntent },
  }),
  getStripeWebhookSecret: () => 'whsec_test',
}));
vi.mock('@/lib/payments/server', () => ({
  createPaymentServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { POST } from '@/app/api/webhooks/stripe/route';

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

  it('fulfills the linked business record after a validated successful payment', async () => {
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
    mocks.retrievePaymentIntent.mockResolvedValue({
      id: 'pi_success',
      latest_charge: {
        id: 'ch_success',
        balance_transaction: { fee: 45, net: 1205 },
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
