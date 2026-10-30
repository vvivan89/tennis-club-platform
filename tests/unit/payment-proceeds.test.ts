import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  paymentIntentRetrieve: vi.fn(),
  chargeRetrieve: vi.fn(),
  balanceTransactionRetrieve: vi.fn(),
  updateError: null as null | { message: string },
  update: vi.fn(),
}));

vi.mock('@/lib/payments/stripe', () => ({
  getStripeClient: () => ({
    paymentIntents: { retrieve: mocks.paymentIntentRetrieve },
    charges: { retrieve: mocks.chargeRetrieve },
    balanceTransactions: { retrieve: mocks.balanceTransactionRetrieve },
  }),
}));

import { syncPaymentProceeds } from '@/lib/payments/proceeds';

function db() {
  const query = {
    update: mocks.update,
    eq: async () => ({ error: mocks.updateError }),
  };
  mocks.update.mockReturnValue(query);
  return { from: () => query } as never;
}

beforeEach(() => {
  mocks.paymentIntentRetrieve.mockReset();
  mocks.chargeRetrieve.mockReset();
  mocks.balanceTransactionRetrieve.mockReset();
  mocks.updateError = null;
  mocks.update.mockReset();
});

describe('syncPaymentProceeds', () => {
  it('uses the expanded charge and balance transaction when Stripe returns objects', async () => {
    mocks.paymentIntentRetrieve.mockResolvedValue({
      latest_charge: {
        id: 'charge-1',
        balance_transaction: { id: 'balance-1', fee: 103, net: 2397 },
      },
    });

    await expect(syncPaymentProceeds(db(), 'payment-1', 'intent-1')).resolves.toEqual({
      feeMinor: 103,
      proceedsMinor: 2397,
    });
    expect(mocks.paymentIntentRetrieve).toHaveBeenCalledWith('intent-1', {
      expand: ['latest_charge.balance_transaction'],
    });
    expect(mocks.chargeRetrieve).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_fee_minor: 103, proceeds_minor: 2397 }),
    );
  });

  it('retrieves charge and balance transaction IDs when Stripe returns references', async () => {
    mocks.paymentIntentRetrieve.mockResolvedValue({ latest_charge: 'charge-2' });
    mocks.chargeRetrieve.mockResolvedValue({ balance_transaction: 'balance-2' });
    mocks.balanceTransactionRetrieve.mockResolvedValue({ fee: 90, net: 2410 });

    await expect(syncPaymentProceeds(db(), 'payment-2', 'intent-2')).resolves.toEqual({
      feeMinor: 90,
      proceedsMinor: 2410,
    });
    expect(mocks.chargeRetrieve).toHaveBeenCalledWith('charge-2', {
      expand: ['balance_transaction'],
    });
    expect(mocks.balanceTransactionRetrieve).toHaveBeenCalledWith('balance-2');
  });

  it('returns null for missing charges, missing transactions, and invalid amounts', async () => {
    mocks.paymentIntentRetrieve.mockResolvedValueOnce({ latest_charge: null });
    await expect(syncPaymentProceeds(db(), 'payment-1', 'intent-1')).resolves.toBeNull();

    mocks.paymentIntentRetrieve.mockResolvedValueOnce({ latest_charge: 'charge-3' });
    mocks.chargeRetrieve.mockResolvedValueOnce({ balance_transaction: null });
    await expect(syncPaymentProceeds(db(), 'payment-1', 'intent-1')).resolves.toBeNull();

    mocks.paymentIntentRetrieve.mockResolvedValueOnce({
      latest_charge: { id: 'charge-4', balance_transaction: { fee: 1.5, net: 2500 } },
    });
    await expect(syncPaymentProceeds(db(), 'payment-1', 'intent-1')).resolves.toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('throws a safe error when proceeds cannot be persisted', async () => {
    mocks.paymentIntentRetrieve.mockResolvedValue({
      latest_charge: { id: 'charge-5', balance_transaction: { fee: 100, net: 2400 } },
    });
    mocks.updateError = { message: 'database details' };

    await expect(syncPaymentProceeds(db(), 'payment-5', 'intent-5')).rejects.toThrow(
      'Could not save Stripe fee and proceeds for the payment.',
    );
  });
});
