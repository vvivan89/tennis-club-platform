import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  paymentUpsert: vi.fn(),
  paymentSelect: vi.fn(),
  paymentMaybeSingle: vi.fn(),
  paymentEq: vi.fn(),
  auditUpsert: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { createPendingPayment } from '@/lib/payments/server';

const payment = {
  id: 'pay_123',
  user_id: 'user_123',
  purpose: 'membership',
  business_record_id: null,
  amount_minor: 1250,
  currency: 'cad',
  status: 'pending',
};

function setup() {
  mocks.paymentUpsert.mockReturnThis();
  mocks.paymentSelect.mockReturnThis();
  mocks.paymentEq.mockReturnThis();
  mocks.paymentMaybeSingle.mockResolvedValue({ data: payment, error: null });
  mocks.auditUpsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'payments') {
      return {
        upsert: mocks.paymentUpsert,
        select: mocks.paymentSelect,
        maybeSingle: mocks.paymentMaybeSingle,
        eq: mocks.paymentEq,
      };
    }
    return { upsert: mocks.auditUpsert };
  });
  mocks.createClient.mockReturnValue({ from: mocks.from });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
}

describe('createPendingPayment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setup();
  });

  it('creates an integer-minor-unit payment and records one idempotent audit action', async () => {
    const result = await createPendingPayment({
      userId: 'user_123',
      purpose: 'membership',
      amountMinor: 1250,
      currency: 'CAD',
      idempotencyKey: 'request-123',
    });
    expect(result).toEqual(payment);
    expect(mocks.paymentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ amount_minor: 1250, currency: 'cad', status: 'pending' }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
    expect(mocks.auditUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.created', target_record_id: 'pay_123' }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('rejects an invalid amount before writing to Supabase', async () => {
    await expect(
      createPendingPayment({
        userId: 'user_123',
        purpose: 'membership',
        amountMinor: 12.5,
        currency: 'CAD',
        idempotencyKey: 'request-123',
      }),
    ).rejects.toThrow(/amount/i);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects idempotency-key reuse with different payment details', async () => {
    mocks.paymentMaybeSingle.mockResolvedValue({
      data: { ...payment, amount_minor: 1500 },
      error: null,
    });
    await expect(
      createPendingPayment({
        userId: 'user_123',
        purpose: 'membership',
        amountMinor: 1250,
        currency: 'CAD',
        idempotencyKey: 'request-123',
      }),
    ).rejects.toThrow(/Idempotency key was already used/);
    expect(mocks.auditUpsert).not.toHaveBeenCalled();
  });
});
