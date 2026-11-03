import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  calls: [] as Array<{ table: string; operation: string; values?: unknown }>,
  rpc: vi.fn(),
  getStripeClient: vi.fn(),
  sessionRetrieve: vi.fn(),
  sessionExpire: vi.fn(),
  intentRetrieve: vi.fn(),
  fetch: vi.fn(),
}));

function response(table: string, operation: string, single: boolean) {
  const keys = [
    `${table}.${operation}.${single ? 'maybeSingle' : 'then'}`,
    `${table}.${operation}`,
    `${table}.maybeSingle`,
    table,
  ];
  for (const key of keys) {
    const queue = mocks.queues[key];
    if (queue?.length) {
      const value = queue.shift();
      return value && typeof value === 'object' && 'data' in value
        ? value
        : { data: value, error: null };
    }
  }
  return { data: single ? null : [], error: null };
}

function queryFor(table: string) {
  let operation = 'select';
  let values: unknown;
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    not: () => query,
    lte: () => query,
    order: () => query,
    limit: () => query,
    range: () => query,
    maybeSingle: async () => response(table, operation, true),
    insert: (payload: unknown) => {
      operation = 'insert';
      values = payload;
      mocks.calls.push({ table, operation, values });
      return query;
    },
    update: (payload: unknown) => {
      operation = 'update';
      values = payload;
      mocks.calls.push({ table, operation, values });
      return query;
    },
    delete: () => {
      operation = 'delete';
      mocks.calls.push({ table, operation });
      return query;
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(response(table, operation, false)).then(resolve, reject),
  };
  return query;
}

vi.mock('@/lib/payments/server', () => ({
  createPaymentServiceClient: () => ({ from: (table: string) => queryFor(table), rpc: mocks.rpc }),
}));
vi.mock('@/lib/payments/stripe', () => ({
  getStripeClient: mocks.getStripeClient,
}));

import { GET } from '@/app/api/notifications/pending-event-payments/route';

function request(authorization = 'Bearer cron-test') {
  return new Request('https://club.test/api/notifications/pending-event-payments', {
    headers: { authorization },
  });
}

function event(cutoff: number) {
  return {
    id: 'event-1',
    slug: 'summer-social',
    title: '<Summer Social>',
    registration_closes_at: new Date(cutoff).toISOString(),
  };
}

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'registration-1',
    event_id: 'event-1',
    user_id: 'member-1',
    status: 'confirmed',
    payment_status: 'pending',
    amount_cents: 2500,
    ...overrides,
  };
}

function pendingPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    user_id: 'member-1',
    purpose: 'event_registration',
    business_record_id: 'registration-1',
    amount_minor: 2500,
    currency: 'cad',
    status: 'pending',
    refunded_amount_minor: 0,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.queues = {};
  mocks.calls = [];
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.sessionRetrieve.mockReset();
  mocks.sessionExpire.mockReset();
  mocks.intentRetrieve.mockReset();
  mocks.fetch.mockReset().mockResolvedValue({ ok: true });
  mocks.getStripeClient.mockReset().mockReturnValue({
    checkout: { sessions: { retrieve: mocks.sessionRetrieve, expire: mocks.sessionExpire } },
    paymentIntents: { retrieve: mocks.intentRetrieve },
  });
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('CRON_SECRET', 'cron-test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test');
  vi.stubEnv('RESEND_API_KEY', 'resend-test');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Club <club@example.test>');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pending event payment reminders', () => {
  it('rejects unauthorized requests and reports missing service configuration', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request('Bearer cron-test'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'cron-test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: 'Supabase service configuration is missing.',
    });
  });

  it('reports event lookup errors and succeeds when no cutoffs are approaching', async () => {
    mocks.queues['events.select'] = [{ data: null, error: { message: 'unavailable' } }];
    const failed = await GET(request());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Could not load event cutoffs.' });

    mocks.queues['events.select'] = [[]];
    const empty = await GET(request());
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ success: true, remindersSent: 0, errors: 0 });
  });

  it('sends an escaped reminder at the 24-hour window and records its delivery', async () => {
    mocks.queues['events.select'] = [[event(Date.now() + 24 * 60 * 60 * 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['profiles.select'] = [
      [
        {
          id: 'member-1',
          email: 'member@example.test',
          full_name: '<Alex>',
          email_registration_reminders: true,
        },
      ],
    ];
    mocks.queues['event_registration_payment_reminders.insert.maybeSingle'] = [
      { id: 'reminder-1' },
    ];

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, remindersSent: 1 });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const email = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body));
    expect(email.to).toEqual(['member@example.test']);
    expect(email.html).toContain('&lt;Alex&gt;');
    expect(email.html).toContain('&lt;Summer Social&gt;');
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'event_registration_payment_reminders',
        operation: 'insert',
      }),
    );
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'event_registration_payment_reminders',
        operation: 'update',
      }),
    );
  });

  it('suppresses recently claimed reminders and skips opted-out recipients', async () => {
    mocks.queues['events.select'] = [[event(Date.now() + 24 * 60 * 60 * 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['profiles.select'] = [
      [
        {
          id: 'member-1',
          email: 'member@example.test',
          full_name: 'Alex',
          email_registration_reminders: true,
        },
      ],
    ];
    mocks.queues['event_registration_payment_reminders.insert.maybeSingle'] = [
      { data: null, error: { code: '23505' } },
    ];
    mocks.queues['event_registration_payment_reminders.select.maybeSingle'] = [
      { id: 'reminder-old', created_at: new Date().toISOString(), sent_at: null },
    ];
    const duplicate = await GET(request());
    expect(await duplicate.json()).toMatchObject({ remindersSent: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.queues['events.select'] = [[event(Date.now() + 24 * 60 * 60 * 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['profiles.select'] = [
      [
        {
          id: 'member-1',
          email: 'member@example.test',
          full_name: 'Alex',
          email_registration_reminders: false,
        },
      ],
    ];
    const optedOut = await GET(request());
    expect(await optedOut.json()).toMatchObject({ remindersSent: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('fulfills already-paid payments and removes unpaid registrations after cutoff', async () => {
    mocks.queues['events.select'] = [[event(Date.now() - 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[pendingPayment({ status: 'succeeded' })]];
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const fulfilled = await GET(request());
    expect(await fulfilled.json()).toMatchObject({ registrationsRemoved: 0, errors: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: 'payment-1',
    });

    mocks.queues['events.select'] = [[event(Date.now() - 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['registrations.select.maybeSingle'] = [null];
    mocks.queues['registrations.update.maybeSingle'] = [{ id: 'registration-1' }];
    const removed = await GET(request());
    expect(await removed.json()).toMatchObject({ registrationsRemoved: 1, errors: 0 });
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'registrations',
        operation: 'update',
        values: expect.objectContaining({ status: 'cancelled', payment_status: 'failed' }),
      }),
    );
  });

  it('reconciles a valid Stripe PaymentIntent and retries when message delivery fails', async () => {
    const payment = pendingPayment({ stripe_payment_intent_id: 'pi-1' });
    mocks.queues['events.select'] = [[event(Date.now() + 60 * 60 * 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[payment]];
    mocks.intentRetrieve.mockResolvedValue({
      id: 'pi-1',
      status: 'succeeded',
      amount: 2500,
      currency: 'cad',
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.queues['payments.update'] = [{ error: null }];
    const reconciled = await GET(request());
    expect(await reconciled.json()).toMatchObject({ remindersSent: 0, errors: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: 'payment-1',
    });

    mocks.queues['events.select'] = [[event(Date.now() + 24 * 60 * 60 * 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['profiles.select'] = [
      [
        {
          id: 'member-1',
          email: 'member@example.test',
          full_name: 'Alex',
          email_registration_reminders: true,
        },
      ],
    ];
    mocks.queues['event_registration_payment_reminders.insert.maybeSingle'] = [
      { id: 'reminder-2' },
    ];
    mocks.fetch.mockResolvedValue({ ok: false });
    const failedDelivery = await GET(request());
    expect(await failedDelivery.json()).toMatchObject({ remindersFailed: 1, success: false });
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'event_registration_payment_reminders',
        operation: 'delete',
      }),
    );
  });

  it('reconciles a completed paid Checkout Session before sending a reminder', async () => {
    const payment = pendingPayment({ stripe_checkout_session_id: 'cs-paid' });
    mocks.queues['events.select'] = [[event(Date.now() + 60 * 60 * 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[payment]];
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs-paid',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
      client_reference_id: payment.id,
      amount_total: payment.amount_minor,
      currency: payment.currency,
      payment_intent: { id: 'pi-paid' },
    });
    mocks.intentRetrieve.mockResolvedValue({
      id: 'pi-paid',
      status: 'succeeded',
      amount: payment.amount_minor,
      currency: payment.currency,
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
    });
    mocks.queues['payments.update'] = [{ error: null }];

    const result = await GET(request());
    expect(await result.json()).toMatchObject({ success: true, remindersSent: 0, errors: 0 });
    expect(mocks.sessionRetrieve).toHaveBeenCalledWith('cs-paid');
    expect(mocks.intentRetrieve).toHaveBeenCalledWith('pi-paid');
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: payment.id,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rechecks a Checkout Session when expiration races with payment completion', async () => {
    const payment = pendingPayment({ stripe_checkout_session_id: 'cs-racing' });
    const metadata = {
      pctc_payment_id: payment.id,
      pctc_purpose: payment.purpose,
      pctc_business_record_id: payment.business_record_id,
      pctc_user_id: payment.user_id,
    };
    mocks.queues['events.select'] = [[event(Date.now() - 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[payment]];
    mocks.sessionRetrieve
      .mockResolvedValueOnce({
        id: 'cs-racing',
        mode: 'payment',
        status: 'open',
        payment_status: 'unpaid',
        metadata,
        client_reference_id: payment.id,
        amount_total: payment.amount_minor,
        currency: payment.currency,
      })
      .mockResolvedValueOnce({
        id: 'cs-racing',
        mode: 'payment',
        status: 'complete',
        payment_status: 'paid',
        metadata,
        client_reference_id: payment.id,
        amount_total: payment.amount_minor,
        currency: payment.currency,
        payment_intent: 'pi-racing',
      });
    mocks.sessionExpire.mockRejectedValue(new Error('already completed'));
    mocks.intentRetrieve.mockResolvedValue({
      id: 'pi-racing',
      status: 'succeeded',
      amount: payment.amount_minor,
      currency: payment.currency,
      metadata,
    });
    mocks.queues['payments.update'] = [{ error: null }];

    const response = await GET(request());
    expect(await response.json()).toMatchObject({ success: true, registrationsRemoved: 0 });
    expect(mocks.sessionRetrieve).toHaveBeenCalledTimes(2);
    expect(mocks.sessionExpire).toHaveBeenCalledWith('cs-racing');
    expect(mocks.intentRetrieve).toHaveBeenCalledWith('pi-racing');
  });

  it('keeps an unpaid registration when Checkout metadata does not match the payment row', async () => {
    const payment = pendingPayment({ stripe_checkout_session_id: 'cs-mismatch' });
    mocks.queues['events.select'] = [[event(Date.now() - 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[payment]];
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs-mismatch',
      mode: 'payment',
      status: 'open',
      payment_status: 'unpaid',
      metadata: { pctc_payment_id: 'some-other-payment' },
      client_reference_id: payment.id,
      amount_total: payment.amount_minor,
      currency: payment.currency,
    });

    const response = await GET(request());
    expect(await response.json()).toMatchObject({
      success: false,
      errors: 1,
      registrationsRemoved: 0,
    });
    expect(mocks.sessionExpire).not.toHaveBeenCalled();
    expect(
      mocks.calls.some((call) => call.table === 'registrations' && call.operation === 'update'),
    ).toBe(false);
  });

  it('removes unpaid registrations when Checkout expires at the cutoff', async () => {
    const payment = pendingPayment({ stripe_checkout_session_id: 'cs-open' });
    mocks.queues['events.select'] = [[event(Date.now() - 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[payment]];
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs-open',
      mode: 'payment',
      status: 'open',
      payment_status: 'unpaid',
      metadata: {
        pctc_payment_id: payment.id,
        pctc_purpose: payment.purpose,
        pctc_business_record_id: payment.business_record_id,
        pctc_user_id: payment.user_id,
      },
      client_reference_id: payment.id,
      amount_total: payment.amount_minor,
      currency: payment.currency,
    });
    mocks.sessionExpire.mockResolvedValue({ id: 'cs-open', status: 'expired' });
    mocks.queues['registrations.select.maybeSingle'] = [null];
    mocks.queues['registrations.update.maybeSingle'] = [{ id: 'registration-1' }];

    const response = await GET(request());
    expect(await response.json()).toMatchObject({ success: true, registrationsRemoved: 1 });
    expect(mocks.sessionExpire).toHaveBeenCalledWith('cs-open');
  });

  it('keeps registrations when a Stripe lookup fails and counts database lookup errors', async () => {
    const cutoff = Date.now() - 1000;
    mocks.queues['events.select'] = [[event(cutoff)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [
      [pendingPayment({ stripe_payment_intent_id: 'pi-unavailable' })],
    ];
    mocks.intentRetrieve.mockRejectedValue(new Error('Stripe unavailable'));
    const stripeFailure = await GET(request());
    expect(await stripeFailure.json()).toMatchObject({ success: false, errors: 1 });
    expect(
      mocks.calls.some((call) => call.table === 'registrations' && call.operation === 'update'),
    ).toBe(false);

    mocks.queues['events.select'] = [[event(cutoff)]];
    mocks.queues['registrations.select'] = [{ data: null, error: { message: 'read failed' } }];
    const registrationFailure = await GET(request());
    expect(await registrationFailure.json()).toMatchObject({ success: false, errors: 1 });

    mocks.queues['events.select'] = [[event(cutoff)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [{ data: null, error: { message: 'read failed' } }];
    const paymentFailure = await GET(request());
    expect(await paymentFailure.json()).toMatchObject({ success: false, errors: 1 });
  });

  it('does not remove registrations when payment is already confirmed in the business record', async () => {
    mocks.queues['events.select'] = [[event(Date.now() - 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['profiles.select'] = [{ data: null, error: { message: 'profile read failed' } }];
    const profileFailure = await GET(request());
    expect(await profileFailure.json()).toMatchObject({ success: false, errors: 1 });

    mocks.queues['events.select'] = [[event(Date.now() - 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['profiles.select'] = [[]];
    mocks.queues['registrations.select.maybeSingle'] = [
      { status: 'confirmed', payment_status: 'paid' },
    ];
    const reconciledFromRegistration = await GET(request());
    expect(await reconciledFromRegistration.json()).toMatchObject({
      success: true,
      registrationsRemoved: 0,
    });
    expect(
      mocks.calls.some((call) => call.table === 'registrations' && call.operation === 'update'),
    ).toBe(false);
  });

  it('fulfills a partially refunded payment while allowing a fully refunded balance to expire', async () => {
    const cutoff = Date.now() - 1000;
    mocks.queues['events.select'] = [[event(cutoff)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [
      [pendingPayment({ status: 'partially_refunded', refunded_amount_minor: 500 })],
    ];
    mocks.queues['profiles.select'] = [[]];

    const stillPaid = await GET(request());
    expect(await stillPaid.json()).toMatchObject({ success: true, registrationsRemoved: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: 'payment-1',
    });
    expect(
      mocks.calls.some((call) => call.table === 'registrations' && call.operation === 'update'),
    ).toBe(false);

    mocks.calls = [];
    mocks.rpc.mockClear();
    mocks.queues['events.select'] = [[event(cutoff)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [
      [pendingPayment({ status: 'partially_refunded', refunded_amount_minor: 2500 })],
    ];
    mocks.queues['profiles.select'] = [[]];
    mocks.queues['registrations.select.maybeSingle'] = [null];
    mocks.queues['registrations.update.maybeSingle'] = [null];

    const fullyRefunded = await GET(request());
    expect(await fullyRefunded.json()).toMatchObject({ success: true, registrationsRemoved: 0 });
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'registrations',
        operation: 'update',
        values: expect.objectContaining({ status: 'cancelled', payment_status: 'failed' }),
      }),
    );
  });

  it('uses the one-hour reminder window and retries a stale reminder claim', async () => {
    mocks.queues['events.select'] = [[event(Date.now() + 60 * 60 * 1000)]];
    mocks.queues['registrations.select'] = [[registration()]];
    mocks.queues['payments.select'] = [[]];
    mocks.queues['profiles.select'] = [
      [
        {
          id: 'member-1',
          email: 'member@example.test',
          full_name: 'Alex',
          email_registration_reminders: true,
        },
      ],
    ];
    mocks.queues['event_registration_payment_reminders.insert.maybeSingle'] = [
      { data: null, error: { code: '23505' } },
      { id: 'reminder-retry' },
    ];
    mocks.queues['event_registration_payment_reminders.select.maybeSingle'] = [
      {
        id: 'reminder-stale',
        created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
        sent_at: null,
      },
    ];

    const response = await GET(request());
    expect(await response.json()).toMatchObject({ success: true, remindersSent: 1 });
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'event_registration_payment_reminders',
        operation: 'delete',
      }),
    );
    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body));
    expect(body.subject).toContain('Final reminder');
  });
});
