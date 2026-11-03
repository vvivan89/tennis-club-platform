import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string; email_confirmed_at?: string },
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
    is: () => query,
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
  account_kind: 'member',
};
const waiver = { version: 3 };
const currentSeasonYear = () => {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    settings.season_start_month - 1,
    settings.season_start_day,
  );
  const end = new Date(
    now.getFullYear(),
    settings.season_end_month - 1,
    settings.season_end_day,
    23,
    59,
    59,
    999,
  );
  return now < start ? now.getFullYear() : now > end ? now.getFullYear() + 1 : now.getFullYear();
};

function currentMembership(id = 'membership-1') {
  const now = new Date();
  const endThisYear = new Date(now.getFullYear(), 8, 30, 23, 59, 59, 999);
  const seasonYear = now > endThisYear ? now.getFullYear() + 1 : now.getFullYear();
  return {
    id,
    payment_status: 'unpaid',
    starts_on: `${seasonYear}-04-01`,
    ends_on: `${seasonYear}-09-30`,
    waiver_version: '3',
    waiver_accepted_at: '2026-05-01T12:00:00.000Z',
  };
}

function configureEventRegistration(
  overrides: Record<string, unknown> = {},
  eventOverrides: Record<string, unknown> = {},
) {
  configureCommon();
  const event = {
    id: 'event-1',
    title: 'Summer Social',
    price_cents: 2500,
    status: 'published',
    starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    registration_opens_at: '2020-01-01T00:00:00Z',
    registration_closes_at: null,
    members_only: false,
    ...eventOverrides,
  };
  mocks.responses['registrations.maybeSingle'] = [
    {
      id: 'registration-1',
      event_id: 'event-1',
      user_id: 'member-1',
      status: 'confirmed',
      payment_status: 'pending',
      amount_cents: 2500,
      created_at: new Date(Date.now() - 60_000).toISOString(),
      event,
      ...overrides,
    },
  ];
  return { purpose: 'event_registration', businessRecordId: 'registration-1' };
}

function configureTournamentRegistration(overrides: Record<string, unknown> = {}) {
  configureCommon();
  const participantId = '33333333-3333-4333-8333-333333333333';
  mocks.responses['tournament_participants.then'] = [
    [
      {
        id: participantId,
        event_id: 'event-tournament',
        user_id: 'member-1',
        amount_cents: 2500,
        payment_status: 'pending',
        status: 'registered',
        confirmation_status: 'confirmed',
        display_name: 'Member Player',
        ...overrides,
      },
    ],
  ];
  mocks.responses['events.maybeSingle'] = [
    {
      id: 'event-tournament',
      title: 'Summer Open',
      event_type: 'tournament',
      status: 'published',
      starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  mocks.responses['payments.then'] = [[]];
  mocks.responses['payments.maybeSingle'] = [null];
  return { purpose: 'tournament_registration', businessRecordId: participantId };
}

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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('checkout route branch coverage', () => {
  it('rejects unsupported requests and reports absent payment storage configuration', async () => {
    expect((await POST(request({ purpose: 'other' }))).status).toBe(400);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const unavailable = await POST(request({ purpose: 'event_registration' }));
    expect(unavailable.status).toBe(500);
    expect(await unavailable.json()).toMatchObject({
      error: 'Could not start checkout. Please try again or contact the club administrator.',
    });
  });

  it('rejects incomplete family checkouts and reports confirmed-member lookup failures', async () => {
    configureCommon();
    const body = {
      purpose: 'membership',
      membershipKind: 'family',
      waiverAccepted: true,
      waiverVersion: 3,
    };
    expect((await POST(request(body))).status).toBe(400);

    configureCommon();
    mocks.responses['membership_families.maybeSingle'] = [
      { id: 'family-1', season_year: currentSeasonYear(), paid_at: null, payment_id: null },
    ];
    mocks.responses['membership_family_members.maybeSingle'] = [
      { id: 'owner-link', status: 'confirmed' },
    ];
    mocks.responses['membership_family_members.then'] = [
      { data: null, error: { message: 'members unavailable' } },
    ];
    const failedLookup = await POST(request({ ...body, businessRecordId: 'family-1' }));
    expect(failedLookup.status).toBe(500);
    expect(await failedLookup.json()).toMatchObject({
      error: 'Could not start checkout. Please try again or contact the club administrator.',
    });
  });

  it('rejects family membership checkout when the family is missing or the payer is not confirmed', async () => {
    configureCommon();
    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [waiver];
    mocks.responses['membership_families.maybeSingle'] = [null];
    let response = await POST(
      request({
        purpose: 'membership',
        membershipKind: 'family',
        businessRecordId: 'family-1',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(response.status).toBe(403);

    mocks.responses = {};
    configureCommon();
    mocks.responses['profiles.maybeSingle'] = [profile];
    mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
    mocks.responses['legal_document_versions.maybeSingle'] = [waiver];
    mocks.responses['membership_families.maybeSingle'] = [
      { id: 'family-1', season_year: currentSeasonYear(), paid_at: null, payment_id: null },
    ];
    mocks.responses['membership_family_members.maybeSingle'] = [null];
    response = await POST(
      request({
        purpose: 'membership',
        membershipKind: 'family',
        businessRecordId: 'family-1',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.createPendingPayment).not.toHaveBeenCalled();
  });

  it('requires two confirmed family members and current individual waivers before checkout', async () => {
    const setupFamily = (members: unknown[]) => {
      configureCommon();
      mocks.responses['profiles.maybeSingle'] = [profile];
      mocks.responses['membership_plan_settings.maybeSingle'] = [settings];
      mocks.responses['legal_document_versions.maybeSingle'] = [waiver];
      mocks.responses['membership_families.maybeSingle'] = [
        { id: 'family-1', season_year: currentSeasonYear(), paid_at: null, payment_id: null },
      ];
      mocks.responses['membership_family_members.maybeSingle'] = [
        { id: 'link-1', status: 'confirmed' },
      ];
      mocks.responses['membership_family_members.then'] = [members, members];
    };
    const body = {
      purpose: 'membership',
      membershipKind: 'family',
      businessRecordId: 'family-1',
      waiverAccepted: true,
      waiverVersion: 3,
    };
    setupFamily([{ user_id: 'member-1', waiver_version: '3', waiver_accepted_at: '2026-01-01' }]);
    let response = await POST(request(body));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/At least two family members/);

    setupFamily([
      {
        user_id: 'member-1',
        waiver_version: '3',
        waiver_accepted_at: '2026-01-01',
        profiles: { application_status: 'approved' },
      },
      {
        user_id: 'member-2',
        waiver_version: '2',
        waiver_accepted_at: '2026-01-01',
        profiles: { application_status: 'approved' },
      },
    ]);
    response = await POST(request(body));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/current waiver/);
    expect(mocks.createPendingPayment).not.toHaveBeenCalled();
  });

  it('rejects already-paid families and families containing an unapproved member', async () => {
    const body = {
      purpose: 'membership',
      membershipKind: 'family',
      businessRecordId: 'family-1',
      waiverAccepted: true,
      waiverVersion: 3,
    };
    configureCommon();
    mocks.responses['membership_families.maybeSingle'] = [
      { id: 'family-1', season_year: currentSeasonYear(), paid_at: '2026-05-01', payment_id: null },
    ];
    mocks.responses['membership_family_members.maybeSingle'] = [{ id: 'owner-link' }];
    mocks.responses['membership_family_members.then'] = [
      [
        { user_id: 'member-1', waiver_version: '3', waiver_accepted_at: '2026-01-01' },
        { user_id: 'member-2', waiver_version: '3', waiver_accepted_at: '2026-01-01' },
      ],
    ];
    expect((await POST(request(body))).status).toBe(409);

    configureCommon();
    mocks.responses['membership_families.maybeSingle'] = [
      { id: 'family-1', season_year: currentSeasonYear(), paid_at: null, payment_id: null },
    ];
    mocks.responses['membership_family_members.maybeSingle'] = [{ id: 'owner-link' }];
    mocks.responses['membership_family_members.then'] = [
      [
        { user_id: 'member-1', waiver_version: '3', waiver_accepted_at: '2026-01-01' },
        { user_id: 'member-2', waiver_version: '3', waiver_accepted_at: '2026-01-01' },
      ],
      [
        {
          user_id: 'member-1',
          waiver_version: '3',
          waiver_accepted_at: '2026-01-01',
          profiles: { application_status: 'approved' },
        },
        {
          user_id: 'member-2',
          waiver_version: '3',
          waiver_accepted_at: '2026-01-01',
          profiles: { application_status: 'pending' },
        },
      ],
    ];
    const unapproved = await POST(request(body));
    expect(unapproved.status).toBe(409);
    expect((await unapproved.json()).error).toMatch(/approved profile/);
  });

  it('renews an unpaid family for the current season and rolls back a failed member copy', async () => {
    const configureRenewal = () => {
      configureCommon();
      const previousYear = currentSeasonYear() - 1;
      mocks.responses['membership_families.maybeSingle'] = [
        { id: 'old-family', season_year: previousYear, paid_at: null, payment_id: null },
      ];
      mocks.responses['membership_family_members.maybeSingle'] = [{ id: 'owner-link' }];
      mocks.responses['membership_family_members.then'] = [
        [
          {
            user_id: 'member-1',
            invited_by: 'member-1',
            waiver_version: '3',
            waiver_accepted_at: '2026-01-01',
          },
          {
            user_id: 'member-2',
            invited_by: 'member-1',
            waiver_version: '3',
            waiver_accepted_at: '2026-01-01',
          },
        ],
        [
          {
            user_id: 'member-1',
            waiver_version: '3',
            waiver_accepted_at: '2026-01-01',
            profiles: { application_status: 'approved' },
          },
          {
            user_id: 'member-2',
            waiver_version: '3',
            waiver_accepted_at: '2026-01-01',
            profiles: [{ application_status: 'approved' }],
          },
        ],
      ];
      mocks.responses['membership_families.insert.single'] = [{ id: 'current-family' }];
      mocks.responses['membership_family_members.insert.then'] = [{ data: [], error: null }];
      mocks.responses['payments.maybeSingle'] = [null];
      mocks.responses['payments.then'] = [{ data: null, error: null }];
      return {
        purpose: 'membership',
        membershipKind: 'family',
        businessRecordId: 'old-family',
        waiverAccepted: true,
        waiverVersion: 3,
      };
    };

    const body = configureRenewal();
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'membership_family_members',
        operation: 'insert',
        values: expect.arrayContaining([
          expect.objectContaining({ family_id: 'current-family', user_id: 'member-1' }),
          expect.objectContaining({ family_id: 'current-family', user_id: 'member-2' }),
        ]),
      }),
    );
    expect(mocks.createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        businessRecordId: 'family:current-family',
        amountMinor: settings.family_price_cents,
      }),
    );

    configureRenewal();
    mocks.responses['membership_family_members.insert.then'] = [
      { data: null, error: { message: 'copy failed' } },
    ];
    const failed = await POST(request(body));
    expect(failed.status).toBe(500);
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({ table: 'membership_families', operation: 'delete' }),
    );
  });

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
    mocks.responses['memberships.maybeSingle'] = [currentMembership()];
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

  it('rejects missing, stale, paid, or waiver-incomplete membership records', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [null];
    let response = await POST(
      request({
        purpose: 'membership',
        businessRecordId: 'missing-membership',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(response.status).toBe(404);

    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [
      { ...currentMembership(), starts_on: '2025-04-01', ends_on: '2025-09-30' },
    ];
    response = await POST(
      request({
        purpose: 'membership',
        businessRecordId: 'old-membership',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(response.status).toBe(409);

    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [
      { ...currentMembership(), payment_status: 'paid' },
    ];
    response = await POST(
      request({
        purpose: 'membership',
        businessRecordId: 'paid-membership',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(response.status).toBe(409);

    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [
      { ...currentMembership(), waiver_accepted_at: null },
    ];
    response = await POST(
      request({
        purpose: 'membership',
        businessRecordId: 'unsigned-membership',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(response.status).toBe(409);
  });

  it('returns a safe checkout error when membership lookups fail', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [
      { data: null, error: { message: 'current membership lookup failed' } },
    ];
    const current = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );
    expect(current.status).toBe(500);

    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [
      { data: null, error: { message: 'membership record lookup failed' } },
    ];
    const existing = await POST(
      request({
        purpose: 'membership',
        businessRecordId: 'membership-1',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(existing.status).toBe(500);
  });

  it('rejects membership prices that are not positive safe amounts', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [currentMembership()];
    mocks.responses['membership_plan_settings.maybeSingle'] = [
      { ...settings, single_price_cents: 0 },
    ];
    const response = await POST(
      request({
        purpose: 'membership',
        businessRecordId: 'membership-1',
        waiverAccepted: true,
        waiverVersion: 3,
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('positive amount'),
    });
  });

  it('returns a current pending membership when one already exists', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [currentMembership('membership-existing')];
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
        event: [
          {
            id: 'event-1',
            title: 'Summer Social',
            price_cents: 2500,
            status: 'published',
            starts_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
            registration_opens_at: '2020-01-01T00:00:00Z',
            registration_closes_at: null,
            members_only: false,
          },
        ],
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
    mocks.responses['memberships.maybeSingle'] = [currentMembership()];
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
    mocks.responses['memberships.maybeSingle'] = [currentMembership()];
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

  it('returns by payment ID when a succeeded Stripe payment has no session reference', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [currentMembership()];
    mocks.responses['memberships.single'] = [{ id: 'membership-1' }];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'succeeded-without-session',
        status: 'succeeded',
        amount_minor: 15000,
        currency: 'cad',
        stripe_checkout_session_id: null,
      },
    ];

    const response = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fulfill_successful_payment', {
      p_payment_id: 'succeeded-without-session',
    });
    expect((await response.json()).checkoutUrl).toContain('payment_id=succeeded-without-session');
  });

  it('returns to a completed existing Stripe session instead of starting another checkout', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [currentMembership()];
    mocks.responses['memberships.single'] = [{ id: 'membership-1' }];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'payment-completed-session',
        status: 'pending',
        amount_minor: 15000,
        currency: 'cad',
        stripe_checkout_session_id: 'cs-complete',
      },
    ];
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs-complete',
      status: 'complete',
      url: null,
      amount_total: 15000,
      currency: 'cad',
      metadata: {
        pctc_payment_id: 'payment-completed-session',
        pctc_purpose: 'membership',
        pctc_business_record_id: 'membership-1',
        pctc_user_id: 'member-1',
      },
    });

    const response = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).checkoutUrl).toContain('session_id=cs-complete');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('replaces an expired Stripe checkout session after marking its payment attempt canceled', async () => {
    configureCommon();
    mocks.responses['memberships.maybeSingle'] = [currentMembership()];
    mocks.responses['memberships.single'] = [{ id: 'membership-1' }];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'payment-expired',
        status: 'pending',
        amount_minor: 15000,
        currency: 'cad',
        stripe_checkout_session_id: 'cs-expired',
      },
    ];
    mocks.responses['payments.update.maybeSingle'] = [{ id: 'payment-expired' }];
    mocks.sessionRetrieve.mockResolvedValue({
      id: 'cs-expired',
      status: 'expired',
      url: null,
      amount_total: 15000,
      currency: 'cad',
      metadata: {
        pctc_payment_id: 'payment-expired',
        pctc_purpose: 'membership',
        pctc_business_record_id: 'membership-1',
        pctc_user_id: 'member-1',
      },
    });
    mocks.createPendingPayment.mockResolvedValue({
      id: 'payment-retried',
      user_id: 'member-1',
      purpose: 'membership',
      business_record_id: 'membership-1',
      amount_minor: 15000,
      currency: 'cad',
      status: 'pending',
    });

    const response = await POST(
      request({ purpose: 'membership', waiverAccepted: true, waiverVersion: 3 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'payments',
        operation: 'update',
        values: expect.objectContaining({ status: 'canceled' }),
      }),
    );
    expect(mocks.createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'member-1',
        purpose: 'membership',
        businessRecordId: 'membership-1',
        amountMinor: 15000,
      }),
    );
    expect(mocks.sessionCreate).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ paymentId: 'payment-retried' });
  });

  it('rejects event registrations outside payment-eligible states and windows', async () => {
    const body = configureEventRegistration();
    mocks.responses['registrations.maybeSingle'] = [];
    expect((await POST(request({ ...body, businessRecordId: '' }))).status).toBe(400);

    for (const override of [
      { registration: { status: 'confirmed', payment_status: 'not_required' } },
      { registration: { status: 'confirmed', payment_status: 'refunded' } },
      { event: { status: 'draft' } },
      { event: { starts_at: new Date(Date.now() - 60_000).toISOString() } },
      { event: { registration_opens_at: new Date(Date.now() + 60_000).toISOString() } },
      { event: { registration_closes_at: new Date(Date.now() - 60_000).toISOString() } },
      { event: { price_cents: 0 } },
    ]) {
      const registrationOverrides = override.registration ?? {};
      const registration = configureEventRegistration(registrationOverrides, override.event ?? {});
      const response = await POST(request(registration));
      expect(response.status).toBe(409);
    }
  });

  it('submits Interac requests, emails instructions, and reuses submitted requests', async () => {
    const body = configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      {
        interac_enabled: true,
        interac_recipient_email: 'transfer@example.test',
        interac_instructions: 'Add your member name.',
      },
    ];
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.responses['payments.insert.single'] = [{ id: 'interac-payment-1' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubEnv('RESEND_API_KEY', 'resend-test');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Club <club@example.test>');

    const submitted = await POST(request({ ...body, provider: 'interac' }));
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({
      provider: 'interac',
      paymentId: 'interac-payment-1',
      amountMinor: 2500,
      recipientEmail: 'transfer@example.test',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'payments',
        operation: 'insert',
        values: expect.objectContaining({ provider: 'interac', manual_review_status: 'submitted' }),
      }),
    );

    mocks.calls = [];
    configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      {
        interac_enabled: true,
        interac_recipient_email: 'transfer@example.test',
        interac_instructions: 'Add your member name.',
      },
    ];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'interac-payment-existing',
        user_id: 'member-1',
        provider: 'interac',
        amount_minor: 2500,
        currency: 'cad',
        status: 'pending',
        manual_review_status: 'submitted',
      },
    ];
    const reused = await POST(request({ ...body, provider: 'interac' }));
    expect(reused.status).toBe(200);
    expect(await reused.json()).toMatchObject({ paymentId: 'interac-payment-existing' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.calls).not.toContainEqual(
      expect.objectContaining({ table: 'payments', operation: 'insert' }),
    );
  });

  it('rejects unavailable Interac configuration and existing requests owned by someone else', async () => {
    let body = configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      { data: null, error: { message: 'settings unavailable' } },
    ];
    let response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(500);

    body = configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      { interac_enabled: false, interac_recipient_email: 'transfer@example.test' },
    ];
    response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(503);

    body = configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      { interac_enabled: true, interac_recipient_email: 'transfer@example.test' },
    ];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'other-payment',
        user_id: 'another-member',
        provider: 'interac',
        amount_minor: 2500,
        currency: 'cad',
        status: 'pending',
      },
    ];
    response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('An active payment already exists'),
    });
  });

  it('rejects Interac requests with mismatched amounts and unsafe Stripe session states', async () => {
    let body = configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      { interac_enabled: true, interac_recipient_email: 'transfer@example.test' },
    ];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'wrong-amount',
        user_id: 'member-1',
        provider: 'interac',
        amount_minor: 3000,
        currency: 'cad',
        status: 'pending',
      },
    ];
    let response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('different amount'),
    });

    body = configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      { interac_enabled: true, interac_recipient_email: 'transfer@example.test' },
    ];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'stripe-no-session',
        user_id: 'member-1',
        provider: 'stripe',
        amount_minor: 2500,
        currency: 'cad',
        status: 'pending',
        stripe_checkout_session_id: null,
      },
    ];
    response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(409);

    body = configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [
      { interac_enabled: true, interac_recipient_email: 'transfer@example.test' },
    ];
    mocks.responses['payments.maybeSingle'] = [
      {
        id: 'stripe-complete',
        user_id: 'member-1',
        provider: 'stripe',
        amount_minor: 2500,
        currency: 'cad',
        status: 'pending',
        stripe_checkout_session_id: 'cs-complete',
      },
    ];
    mocks.sessionRetrieve.mockResolvedValue({ id: 'cs-complete', status: 'complete' });
    response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('already been completed'),
    });
  });

  it('handles concurrent and empty Interac payment inserts safely', async () => {
    const body = configureEventRegistration();
    const interacSettings = {
      interac_enabled: true,
      interac_recipient_email: 'transfer@example.test',
      interac_instructions: 'Add your member name.',
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.responses['payment_method_settings.maybeSingle'] = [interacSettings];
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.responses['payments.insert.single'] = [
      {
        data: null,
        error: { code: '23505', message: 'duplicate active payment' },
      },
    ];
    let response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('already exists'),
    });

    configureEventRegistration();
    mocks.responses['payment_method_settings.maybeSingle'] = [interacSettings];
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.responses['payments.insert.single'] = [{ data: null, error: null }];
    response = await POST(request({ ...body, provider: 'interac' }));
    expect(response.status).toBe(500);
  });

  it('reports missing Checkout URLs and failed session reference writes', async () => {
    const body = configureEventRegistration();
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.responses['payments.then'] = [{ data: null, error: null }];
    mocks.sessionCreate.mockResolvedValue({ id: 'cs-no-url', url: null, customer: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let response = await POST(request(body));
    expect(response.status).toBe(500);

    configureEventRegistration();
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.responses['payments.then'] = [{ data: null, error: null }];
    mocks.responses['payments.update.then'] = [
      {
        data: null,
        error: { message: 'write failed' },
      },
    ];
    response = await POST(request(body));
    expect(response.status).toBe(500);
  });

  it('creates a Stripe checkout for a verified event guest entry', async () => {
    configureCommon();
    mocks.user = {
      id: 'guest-user',
      email: 'guest@example.test',
      email_confirmed_at: '2026-05-01T12:00:00.000Z',
    };
    mocks.responses['profiles.maybeSingle'] = [
      {
        id: 'guest-user',
        email: 'guest@example.test',
        full_name: 'Guest Player',
        application_status: 'pending',
        account_kind: 'event_guest',
      },
    ];
    const participantId = '11111111-1111-4111-8111-111111111111';
    mocks.responses['tournament_participants.then'] = [
      [
        {
          id: participantId,
          event_id: 'event-tournament',
          user_id: 'guest-user',
          amount_cents: 2500,
          payment_status: 'pending',
          status: 'registered',
          confirmation_status: 'confirmed',
          display_name: 'Guest Player',
        },
      ],
    ];
    mocks.responses['tournament_participants.maybeSingle'] = [{ email: 'guest@example.test' }];
    mocks.responses['events.maybeSingle'] = [
      {
        id: 'event-tournament',
        title: 'Summer Open',
        event_type: 'tournament',
        status: 'published',
        starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    mocks.responses['payments.then'] = [[]];
    mocks.responses['payments.maybeSingle'] = [null];
    mocks.createPendingPayment.mockResolvedValue({
      id: 'guest-payment',
      user_id: 'guest-user',
      purpose: 'tournament_registration',
      business_record_id: participantId,
      amount_minor: 2500,
      currency: 'cad',
      status: 'pending',
    });

    const response = await POST(
      request({
        purpose: 'tournament_registration',
        businessRecordId: participantId,
        returnTo: '/?guest_payment_ids=entry%2Cpartner',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checkoutUrl: 'https://checkout.example/session',
      paymentId: 'guest-payment',
    });
    expect(mocks.createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'guest-user',
        purpose: 'tournament_registration',
        businessRecordId: participantId,
        amountMinor: 2500,
        currency: 'cad',
      }),
    );
    expect(mocks.sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'guest@example.test',
        metadata: expect.objectContaining({
          pctc_purpose: 'tournament_registration',
          pctc_business_record_id: participantId,
          pctc_user_id: 'guest-user',
        }),
        success_url: expect.stringContaining(
          encodeURIComponent('/?guest_payment_ids=entry%2Cpartner'),
        ),
      }),
      { idempotencyKey: 'pctc-checkout:guest-payment' },
    );
  });

  it('rejects invalid tournament entry references and overlapping active payments', async () => {
    configureCommon();
    const invalid = await POST(
      request({ purpose: 'tournament_registration', businessRecordId: 'not-a-uuid' }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'Select one or two valid tournament entries to pay.',
    });

    configureCommon();
    const participantId = '22222222-2222-4222-8222-222222222222';
    mocks.responses['tournament_participants.then'] = [
      [
        {
          id: participantId,
          event_id: 'event-tournament',
          user_id: 'member-1',
          amount_cents: 2500,
          payment_status: 'pending',
          status: 'registered',
          confirmation_status: 'confirmed',
          display_name: 'Member Player',
        },
      ],
    ];
    mocks.responses['events.maybeSingle'] = [
      {
        id: 'event-tournament',
        title: 'Summer Open',
        event_type: 'tournament',
        status: 'published',
        starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    mocks.responses['payments.then'] = [
      [
        {
          business_record_id: participantId,
          user_id: 'another-member',
          status: 'pending',
        },
      ],
    ];

    const overlap = await POST(
      request({ purpose: 'tournament_registration', businessRecordId: participantId }),
    );
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toMatchObject({
      error: expect.stringContaining('A payment attempt is already active'),
    });
    expect(mocks.createPendingPayment).not.toHaveBeenCalled();
  });

  it('validates tournament entry queries, payer membership, partner confirmation and event state', async () => {
    let body = configureTournamentRegistration();
    mocks.responses['tournament_participants.then'] = [
      { data: null, error: { message: 'participant query failed' } },
    ];
    expect((await POST(request(body))).status).toBe(500);

    body = configureTournamentRegistration({ user_id: 'someone-else' });
    expect((await POST(request(body))).status).toBe(403);

    body = configureTournamentRegistration();
    mocks.responses['tournament_pairs.then'] = [
      [{ player_one_id: '33333333-3333-4333-8333-333333333333', player_two_id: 'partner-id' }],
    ];
    mocks.responses['tournament_participants.then'] = [
      [
        {
          id: '33333333-3333-4333-8333-333333333333',
          event_id: 'event-tournament',
          user_id: 'member-1',
          amount_cents: 2500,
          payment_status: 'pending',
          status: 'registered',
          confirmation_status: 'confirmed',
        },
      ],
      [{ id: 'partner-id', status: 'registered', confirmation_status: 'pending' }],
    ];
    expect((await POST(request(body))).status).toBe(409);

    body = configureTournamentRegistration();
    mocks.responses['tournament_participants.then'] = [
      [
        {
          id: '33333333-3333-4333-8333-333333333333',
          event_id: 'event-tournament',
          user_id: 'member-1',
          amount_cents: 2500,
          payment_status: 'paid',
          status: 'registered',
          confirmation_status: 'confirmed',
        },
      ],
    ];
    expect((await POST(request(body))).status).toBe(409);

    body = configureTournamentRegistration();
    mocks.responses['events.maybeSingle'] = [null];
    expect((await POST(request(body))).status).toBe(409);

    body = configureTournamentRegistration();
    mocks.responses['events.maybeSingle'] = [
      {
        id: 'event-tournament',
        title: 'Draft Open',
        event_type: 'tournament',
        status: 'draft',
        starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    expect((await POST(request(body))).status).toBe(409);
  });

  it.each([
    ['first', 'selectedOne'],
    ['second', 'selectedTwo'],
  ])(
    'allows a confirmed partner to pay when the payer is selected on the %s side',
    async (_label, side) => {
      const body = configureTournamentRegistration();
      const participantId = '33333333-3333-4333-8333-333333333333';
      const partnerId = '44444444-4444-4444-8444-444444444444';
      mocks.responses['tournament_participants.then'] = [
        [
          {
            id: participantId,
            event_id: 'event-tournament',
            user_id: 'member-1',
            amount_cents: 2500,
            payment_status: 'pending',
            status: 'registered',
            confirmation_status: 'confirmed',
          },
        ],
        [{ id: partnerId, status: 'registered', confirmation_status: 'confirmed' }],
      ];
      mocks.responses['tournament_pairs.then'] = [
        [
          side === 'selectedOne'
            ? { player_one_id: participantId, player_two_id: partnerId }
            : { player_one_id: partnerId, player_two_id: participantId },
        ],
      ];

      const response = await POST(request(body));

      expect(response.status).toBe(200);
      expect(mocks.createPendingPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'tournament_registration',
          businessRecordId: participantId,
          amountMinor: 2500,
        }),
      );
      expect(mocks.sessionCreate).toHaveBeenCalledOnce();
    },
  );
});
