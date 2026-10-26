import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  responses: {} as Record<string, unknown[]>,
  calls: [] as Array<{ table: string; operation: string; values?: unknown }>,
  createClient: vi.fn(),
  createPendingPayment: vi.fn(),
  getStripeClient: vi.fn(),
  sessionCreate: vi.fn(),
  sessionRetrieve: vi.fn(),
  rpc: vi.fn(),
}));

function nextResult(table: string, operation: string, terminal: string) {
  const keys = [
    `${table}.${operation}.${terminal}`,
    `${table}.${operation}`,
    `${table}.${terminal}`,
    table,
  ];
  for (const key of keys) {
    const queue = mocks.responses[key];
    if (queue?.length) {
      const value = queue.shift();
      return value && typeof value === 'object' && 'data' in value
        ? value
        : { data: value, error: null };
    }
  }
  return { data: terminal === 'then' ? null : null, error: null };
}

function queryFor(table: string) {
  let operation = 'select';
  let values: unknown;
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => nextResult(table, operation, 'maybeSingle'),
    single: async () => nextResult(table, operation, 'single'),
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
      Promise.resolve(nextResult(table, operation, 'then')).then(resolve, reject),
  };
  return query;
}

function serviceClient() {
  return {
    from: (table: string) => queryFor(table),
    rpc: mocks.rpc,
  };
}

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/payments/server', () => ({ createPendingPayment: mocks.createPendingPayment }));
vi.mock('@/lib/payments/stripe', () => ({ getStripeClient: mocks.getStripeClient }));

import { POST } from '@/app/api/payments/checkout/route';

function request(body: unknown) {
  return new Request('https://club.example/api/payments/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const settings = {
  single_price_cents: 15000,
  family_price_cents: 22000,
  season_start_month: 4,
  season_start_day: 1,
  season_end_month: 9,
  season_end_day: 30,
};
const profile = {
  id: 'member-1',
  email: 'member@example.test',
  full_name: 'Alex Member',
  application_status: 'approved',
};
const waiver = { version: 3 };

function configureCommon() {
  mocks.responses['profiles.maybeSingle'] = [profile];
  mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
  mocks.responses['legal_document_versions.maybeSingle'] = [waiver];
  mocks.createPendingPayment.mockResolvedValue({
    id: 'payment-1',
    user_id: 'member-1',
    purpose: 'membership',
    business_record_id: 'membership-1',
    amount_minor: 15000,
    currency: 'cad',
    status: 'pending',
  });
  mocks.sessionCreate.mockResolvedValue({
    id: 'cs-new',
    url: 'https://checkout.example/session',
    customer: 'cus-1',
  });
}

beforeEach(() => {
  mocks.user = { id: 'member-1', email: 'fallback@example.test' };
  mocks.responses = {};
  mocks.calls = [];
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.createClient.mockReset().mockImplementation(serviceClient);
  mocks.createPendingPayment.mockReset();
  mocks.sessionCreate.mockReset();
  mocks.sessionRetrieve.mockReset();
  mocks.getStripeClient.mockReset().mockReturnValue({
    checkout: { sessions: { create: mocks.sessionCreate, retrieve: mocks.sessionRetrieve } },
  });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test');
});

describe('checkout route branch coverage', () => {
  it('rejects long idempotency keys, unavailable profiles, and settings failures', async () => {
    const longKey = await POST(
      request({ purpose: 'event_registration', idempotencyKey: 'x'.repeat(201) }),
    );
    expect(longKey.status).toBe(400);
    expect(await longKey.json()).toEqual({ error: 'Invalid payment request key.' });

    mocks.responses['profiles.maybeSingle'] = [{ ...profile, application_status: 'pending' }];
    const unapproved = await POST(request({ purpose: 'event_registration' }));
    expect(unapproved.status).toBe(403);

    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [
      { data: null, error: { message: 'database' } },
    ];
    const settingsError = await POST(request({ purpose: 'event_registration' }));
    expect(settingsError.status).toBe(500);
  });

  it('validates membership settings, waiver acceptance, and waiver version', async () => {
    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [null];
    expect((await POST(request({ purpose: 'membership', waiverAccepted: true }))).status).toBe(503);

    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
    expect((await POST(request({ purpose: 'membership' }))).status).toBe(400);

    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [{ version: 3 }];
    expect(
      (await POST(request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 2 })))
        .status,
    ).toBe(409);

    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [null];
    const missingWaiver = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );
    expect(missingWaiver.status).toBe(503);
  });

  it('creates an individual membership checkout and restricts unsafe return paths', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [null];
    mocks.responses['memberships.single'] = [{ id: 'membership-1' }];
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.responses['payments.then'] = [{ data: null, error: null }];

    const response = await POST(
      request({
        purpose: 'membership',
        waiverAccepted: true,
        waiverVersion: 3,
        idempotencyKey: 'membership-checkout',
        returnTo: '//evil.example',
        returnLabel: '  Back home  ',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checkoutUrl: 'https://checkout.example/session',
      paymentId: 'payment-1',
    });
    expect(mocks.createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'member-1',
        purpose: 'membership',
        businessRecordId: 'membership-1',
        amountMinor: 15000,
        currency: 'cad',
      }),
    );
    expect(mocks.sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'member@example.test',
        success_url: expect.stringContaining('return_to=%2Fmember%2Fmembership'),
        cancel_url: expect.stringContaining('canceled=1'),
      }),
      { idempotencyKey: 'pctc-checkout:payment-1' },
    );
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'payments',
        operation: 'update',
        values: expect.objectContaining({ stripe_checkout_session_id: 'cs-new' }),
      }),
    );
  });

  it('returns a current pending membership when one already exists', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [{ id: 'membership-existing' }];
    mocks.responses['memberships.then'] = [{ data: null, error: null }];
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.createPendingPayment.mockResolvedValue({
      id: 'payment-existing',
      user_id: 'member-1',
      purpose: 'membership',
      business_record_id: 'membership-existing',
      amount_minor: 15000,
      currency: 'cad',
      status: 'pending',
    });

    const response = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );
    expect(response.status).toBe(200);
    expect(mocks.createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ businessRecordId: 'membership-existing' }),
    );
  });

  it('validates event-registration ownership, state, dates, and price', async () => {
    configureCommon();
    mocks.responses['profiles.maybeSingle'] = [profile, profile, profile, profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [
      settings,
      settings,
      settings,
      settings,
    ];
    const base = {
      id: 'registration-1',
      event_id: 'event-1',
      user_id: 'member-1',
      status: 'confirmed',
      payment_status: 'pending',
      amount_cents: 2500,
      created_at: new Date(Date.now() - 60_000).toISOString(),
      event: {
        id: 'event-1',
        title: 'Social',
        price_cents: 2500,
        status: 'published',
        starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        registration_opens_at: '2020-01-01T00:00:00Z',
        registration_closes_at: null,
        members_only: false,
      },
    };
    mocks.responses['registrations.maybeSingle'] = [null];
    expect(
      (await POST(request({ purpose: 'event_registration', businessRecordId: 'registration-1' })))
        .status,
    ).toBe(404);

    mocks.responses['registrations.maybeSingle'] = [{ ...base, status: 'waitlisted' }];
    expect(
      (await POST(request({ purpose: 'event_registration', businessRecordId: 'registration-1' })))
        .status,
    ).toBe(409);

    mocks.responses['registrations.maybeSingle'] = [{ ...base, payment_status: 'paid' }];
    expect(
      (await POST(request({ purpose: 'event_registration', businessRecordId: 'registration-1' })))
        .status,
    ).toBe(409);

    mocks.responses['registrations.maybeSingle'] = [
      { ...base, event: { ...base.event, price_cents: 3000 } },
    ];
    expect(
      (await POST(request({ purpose: 'event_registration', businessRecordId: 'registration-1' })))
        .status,
    ).toBe(409);
  });

  it('starts event checkout using the event title and fallback email', async () => {
    configureCommon();
    mocks.responses['profiles.maybeSingle'] = [{ ...profile, email: null }];
    const now = Date.now();
    mocks.responses['registrations.maybeSingle'] = [
      {
        id: 'registration-1',
        event_id: 'event-1',
        user_id: 'member-1',
        status: 'confirmed',
        payment_status: 'pending',
        amount_cents: 2500,
        created_at: new Date(now - 60_000).toISOString(),
        event: {
          id: 'event-1',
          title: 'Summer Social',
          price_cents: 2500,
          status: 'published',
          starts_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
          registration_opens_at: '2020-01-01T00:00:00Z',
          registration_closes_at: null,
          members_only: false,
        },
      },
    ];
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.responses['payments.then'] = [{ data: null, error: null }];

    const response = await POST(
      request({
        purpose: 'event_registration',
        businessRecordId: 'registration-1',
        returnTo: '/events/summer',
        returnLabel: 'Back to summer',
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'event_registration',
        businessRecordId: 'registration-1',
        amountMinor: 2500,
      }),
    );
    expect(mocks.sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'fallback@example.test',
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              product_data: { name: 'PCTC event registration — Summer Social' },
            }),
          }),
        ],
      }),
      expect.any(Object),
    );
  });

  it('reuses succeeded payments and open checkout sessions', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [null];
    mocks.responses['memberships.single'] = [{ id: 'membership-1' }];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'payment-old',
        status: 'succeeded',
        amount_minor: 15000,
        currency: 'cad',
        stripe_checkout_session_id: 'cs-old',
      },
    ];
    const succeeded = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );
    expect(succeeded.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: 'payment-old',
    });
    expect((await succeeded.json()).checkoutUrl).toContain('session_id=cs-old');

    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [waiver];
    mocks.responses['memberships.maybeSingle'] = [null];
    mocks.responses['memberships.single'] = [{ id: 'membership-1' }];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'payment-open',
        status: 'pending',
        amount_minor: 15000,
        currency: 'cad',
        stripe_checkout_session_id: 'cs-open',
      },
    ];
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs-open',
      status: 'open',
      url: 'https://checkout.example/existing',
      amount_total: 15000,
      currency: 'cad',
      metadata: {
        pctc_payment_id: 'payment-open',
        pctc_purpose: 'membership',
        pctc_business_record_id: 'membership-1',
        pctc_user_id: 'member-1',
      },
    });
    const open = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );
    expect(await open.json()).toMatchObject({ checkoutUrl: 'https://checkout.example/existing' });
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });
});
