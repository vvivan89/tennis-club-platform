import 'server-only';
import type Stripe from 'stripe';
import { createPaymentServiceClient } from './server';
import { getStripeClient } from './stripe';

/** Persist Stripe's actual balance-transaction fee and net proceeds for a succeeded payment. */
export async function syncPaymentProceeds(
  db: ReturnType<typeof createPaymentServiceClient>,
  paymentId: string,
  paymentIntentId: string,
): Promise<{ feeMinor: number; proceedsMinor: number } | null> {
  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge.balance_transaction'],
  });
  const chargeValue = intent.latest_charge;
  const chargeId = typeof chargeValue === 'string' ? chargeValue : chargeValue?.id;
  if (!chargeId) return null;
  const charge =
    typeof chargeValue === 'object' && chargeValue !== null
      ? (chargeValue as Stripe.Charge)
      : await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
  const transactionValue = charge.balance_transaction;
  const transaction =
    typeof transactionValue === 'string'
      ? await stripe.balanceTransactions.retrieve(transactionValue)
      : transactionValue;
  if (!transaction || typeof transaction === 'string') return null;
  const feeMinor = transaction.fee;
  const proceedsMinor = transaction.net;
  if (!Number.isSafeInteger(feeMinor) || !Number.isSafeInteger(proceedsMinor)) return null;
  const { error } = await db
    .from('payments')
    .update({
      stripe_fee_minor: feeMinor,
      proceeds_minor: proceedsMinor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId);
  if (error) throw new Error('Could not save Stripe fee and proceeds for the payment.');
  return { feeMinor, proceedsMinor };
}
