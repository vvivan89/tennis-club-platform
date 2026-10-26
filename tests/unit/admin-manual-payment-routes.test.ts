import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  profile: { role: 'admin', application_status: 'approved' } as null | {
    role: string;
    application_status: string;
  },
  results: {} as Record<string, { data: unknown; error: unknown }>,
  calls: [] as Array<{ table: string; operation: string; values?: unknown }>,
  rpc: vi.fn(),
  fetch: vi.fn(),
}));

function resultFor(table: string, operation: string) {
  return mocks.results[`${table}.${operation}`] ?? { data: null, error: null };
}

function queryFor(table: string, authProfile = false) {
  let operation = 'select';
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: async () =>
      authProfile && table === 'profiles'
        ? { data: mocks.profile, error: null }
        : resultFor(table, operation),
    upsert: (values: unknown) => {
      operation = 'upsert';
      mocks.calls.push({ table, operation, values });
      return query;
    },
    update: (values: unknown) => {
      operation = 'update';
      mocks.calls.push({ table, operation, values });
      return query;
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor(table, operation)).then(resolve, reject),
  };
  return query;
}

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => queryFor(table, true),
    rpc: mocks.rpc,
  }),
}));
vi.mock('@/lib/payments/server', () => ({
  createPaymentServiceClient: () => ({ from: (table: string) => queryFor(table) }),
}));

import {
  GET as settingsGetHandler,
  PUT as settingsPutHandler,
} from '@/app/api/admin/payments/interac-settings/route';
import { POST as manualRefundHandler } from '@/app/api/admin/payments/manual-refund/route';
import { POST as reviewHandler } from '@/app/api/admin/payments/review/route';

function request(url: string, method = 'GET', body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

const settingsUrl = 'https://club.test/api/admin/payments/interac-settings';
const manualRefundUrl = 'https://club.test/api/admin/payments/manual-refund';
const reviewUrl = 'https://club.test/api/admin/payments/review';

function requireResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Route handler returned no response.');
  return response;
}

const settingsGet = async () => requireResponse(await settingsGetHandler());
const settingsPut = async (input: Request) => requireResponse(await settingsPutHandler(input));
const manualRefundPost = async (input: Request) =>
  requireResponse(await manualRefundHandler(input));
const reviewPost = async (input: Request) => requireResponse(await reviewHandler(input));

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.results = {};
  mocks.calls = [];
  mocks.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Interac settings endpoints', () => {
  it('enforces administrator access when reading and writing settings', async () => {
    mocks.user = null;
    expect((await settingsGet()).status).toBe(401);
    expect((await settingsPut(request(settingsUrl, 'PUT', {}))).status).toBe(401);

    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    expect((await settingsGet()).status).toBe(403);
    expect((await settingsPut(request(settingsUrl, 'PUT', {}))).status).toBe(403);
  });

  it('returns saved settings and handles lookup failures', async () => {
    const saved = {
      interac_enabled: true,
      interac_recipient_email: 'payments@example.test',
      interac_instructions: 'Use your name as the note.',
      updated_at: '2026-10-01T00:00:00Z',
    };
    mocks.results['payment_method_settings.select'] = { data: saved, error: null };
    const response = await settingsGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings: saved });

    mocks.results['payment_method_settings.select'] = {
      data: null,
      error: { message: 'database detail' },
    };
    const failed = await settingsGet();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Could not load Interac settings.' });
  });

  it('validates enabled settings, trims fields, and saves disabled settings', async () => {
    const invalid = await settingsPut(
      request(settingsUrl, 'PUT', { enabled: true, recipientEmail: 'not-an-email' }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: expect.stringContaining('valid Interac') });

    const tooLong = await settingsPut(
      request(settingsUrl, 'PUT', {
        enabled: false,
        recipientEmail: 'x'.repeat(255),
      }),
    );
    expect(tooLong.status).toBe(400);

    const response = await settingsPut(
      request(settingsUrl, 'PUT', {
        enabled: false,
        recipientEmail: '  member@example.test  ',
        instructions: '  Send a note  ',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.calls).toContainEqual({
      table: 'payment_method_settings',
      operation: 'upsert',
      values: expect.objectContaining({
        interac_enabled: false,
        interac_recipient_email: 'member@example.test',
        interac_instructions: 'Send a note',
        updated_by: 'admin-1',
      }),
    });
  });

  it('returns safe errors for malformed requests and failed writes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await settingsPut(request(settingsUrl, 'PUT', '{'))).status).toBe(500);
    mocks.results['payment_method_settings.upsert'] = {
      data: null,
      error: { message: 'database detail' },
    };
    const failed = await settingsPut(request(settingsUrl, 'PUT', { enabled: false }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Could not save Interac settings.' });
  });
});

describe('manual Interac refund endpoint', () => {
  it('requires an approved administrator and validates refund input', async () => {
    mocks.user = null;
    expect((await manualRefundPost(request(manualRefundUrl, 'POST', {}))).status).toBe(401);
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    expect((await manualRefundPost(request(manualRefundUrl, 'POST', {}))).status).toBe(403);
    mocks.profile = { role: 'admin', application_status: 'approved' };

    const invalidBodies = [
      {},
      { paymentId: 'payment-1', amountMinor: 0, idempotencyKey: 'key-1' },
      { paymentId: 'payment-1', amountMinor: 12.5, idempotencyKey: 'key-1' },
      { paymentId: 'payment-1', amountMinor: 100, idempotencyKey: '' },
      { paymentId: 'payment-1', amountMinor: 100, idempotencyKey: 'key-1', note: 12 },
      { paymentId: 'payment-1', amountMinor: 100, idempotencyKey: 'key-1', note: 'x'.repeat(501) },
    ];
    for (const body of invalidBodies) {
      const response = await manualRefundPost(request(manualRefundUrl, 'POST', body));
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('records a valid refund and returns RPC errors safely', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { refundId: 'refund-1', amountMinor: 300, status: 'succeeded' },
      error: null,
    });
    const response = await manualRefundPost(
      request(manualRefundUrl, 'POST', {
        paymentId: 'payment-1',
        amountMinor: 300,
        idempotencyKey: 'refund-key',
        note: '  member request  ',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      refundId: 'refund-1',
      amountMinor: 300,
      status: 'succeeded',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('record_manual_interac_refund', {
      p_payment_id: 'payment-1',
      p_amount_minor: 300,
      p_note: 'member request',
      p_idempotency_key: 'refund-key',
    });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Refund unavailable.' } });
    const failed = await manualRefundPost(
      request(manualRefundUrl, 'POST', {
        paymentId: 'payment-1',
        amountMinor: 300,
        idempotencyKey: 'refund-key-2',
      }),
    );
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: 'Refund unavailable.' });
  });

  it('returns a safe error for malformed JSON', async () => {
    expect((await manualRefundPost(request(manualRefundUrl, 'POST', '{'))).status).toBe(500);
  });
});

describe('manual payment review endpoint', () => {
  it('enforces administrator access and validates the action', async () => {
    mocks.user = null;
    expect((await reviewPost(request(reviewUrl, 'POST', {}))).status).toBe(401);
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    expect((await reviewPost(request(reviewUrl, 'POST', {}))).status).toBe(403);
    mocks.profile = { role: 'admin', application_status: 'approved' };
    expect((await reviewPost(request(reviewUrl, 'POST', {}))).status).toBe(400);
    expect(
      (await reviewPost(request(reviewUrl, 'POST', { paymentId: 'payment-1', action: 'refund' })))
        .status,
    ).toBe(400);
  });

  it('returns RPC failures and skips outcome emails for duplicate results', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Review unavailable.' } });
    const failed = await reviewPost(
      request(reviewUrl, 'POST', { paymentId: 'payment-1', action: 'confirm' }),
    );
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: 'Review unavailable.' });

    mocks.results['payments.select'] = {
      data: { user_id: 'member-1', manual_outcome_sent_at: null },
      error: null,
    };
    mocks.rpc.mockResolvedValueOnce({ data: { duplicate: true }, error: null });
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Club <club@example.test>');
    const duplicate = await reviewPost(
      request(reviewUrl, 'POST', { paymentId: 'payment-1', action: 'confirm' }),
    );
    expect(duplicate.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('emails successful review outcomes and marks delivery on the payment', async () => {
    mocks.results['payments.select'] = {
      data: { user_id: 'member-1', manual_outcome_sent_at: null },
      error: null,
    };
    mocks.results['profiles.select'] = {
      data: { email: 'member@example.test', full_name: 'Alex' },
      error: null,
    };
    mocks.rpc.mockResolvedValueOnce({
      data: {
        userId: 'member-1',
        amountMinor: 4500,
        currency: 'cad',
        purpose: 'membership',
        status: 'succeeded',
        manualReviewStatus: 'confirmed',
      },
      error: null,
    });
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Club <club@example.test>');
    const response = await reviewPost(
      request(reviewUrl, 'POST', { paymentId: 'payment-1', action: 'confirm' }),
    );
    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body))).toMatchObject({
      to: ['member@example.test'],
      subject: 'PCTC Interac payment confirmed',
    });
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({ table: 'payments', operation: 'update' }),
    );
  });

  it('keeps review successful when outcome email delivery fails', async () => {
    mocks.results['payments.select'] = {
      data: { user_id: 'member-1', manual_outcome_sent_at: null },
      error: null,
    };
    mocks.results['profiles.select'] = {
      data: { email: 'member@example.test', full_name: null },
      error: null,
    };
    mocks.rpc.mockResolvedValueOnce({ data: { amountMinor: 1000 }, error: null });
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('EMAIL_FROM', 'club@example.test');
    const response = await reviewPost(
      request(reviewUrl, 'POST', { paymentId: 'payment-1', action: 'reject', note: 'Missing ref' }),
    );
    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body))).toMatchObject({
      subject: 'PCTC Interac payment requires attention',
    });
    expect(mocks.calls).not.toContainEqual(
      expect.objectContaining({ table: 'payments', operation: 'update' }),
    );
  });
});
