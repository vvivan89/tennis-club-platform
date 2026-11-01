import type Stripe from 'stripe';
import type { createServiceRoleClient } from '@/lib/supabase-service';

/** Upserts a Stripe refund into `payment_refunds`; returns the DB error, if any. */
export async function upsertStripeRefund(
  db: ReturnType<typeof createServiceRoleClient>,
  paymentId: string,
  refund: Stripe.Refund,
  extra: { last_stripe_event_id?: string } = {},
) {
  const { error } = await db.from('payment_refunds').upsert(
    {
      payment_id: paymentId,
      stripe_refund_id: refund.id,
      amount_minor: refund.amount,
      currency: refund.currency.toLowerCase(),
      status: refund.status ?? 'pending',
      reason: refund.reason ?? null,
      ...extra,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_refund_id' },
  );
  return error;
}
