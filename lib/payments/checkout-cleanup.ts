import { getStripeClient } from '@/lib/payments/stripe';
import type { createServiceRoleClient } from '@/lib/supabase-service';

type Db = ReturnType<typeof createServiceRoleClient>;

const OPEN_PAYMENT_STATUSES = ['pending', 'processing', 'failed'];

export function canceledPaymentPatch() {
  const now = new Date().toISOString();
  return { status: 'canceled', canceled_at: now, updated_at: now };
}

/** Marks an open payment succeeded; `updated` is false when it was no longer open. */
export async function markPaymentSucceeded(db: Db, paymentId: string, paymentIntentId: string) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('payments')
    .update({
      status: 'succeeded',
      stripe_payment_intent_id: paymentIntentId,
      succeeded_at: now,
      updated_at: now,
    })
    .eq('id', paymentId)
    .in('status', OPEN_PAYMENT_STATUSES)
    .select('id')
    .maybeSingle();
  return { updated: !!data, error, succeededAt: now };
}

/** Expires an open Stripe Checkout session. `verify` re-reads it to confirm it is really expired. */
export async function expireCheckoutSession(
  sessionId: string,
  { verify = false }: { verify?: boolean } = {},
): Promise<'complete' | 'uncertain' | 'expired'> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === 'complete') return 'complete';
  if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
  if (!verify) return 'expired';
  const verified = await stripe.checkout.sessions.retrieve(sessionId);
  return verified.status === 'expired' ? 'expired' : 'uncertain';
}

export async function markPaymentCanceled(db: Db, paymentId: string, errorMessage: string) {
  const { error } = await db
    .from('payments')
    .update(canceledPaymentPatch())
    .eq('id', paymentId)
    .in('status', OPEN_PAYMENT_STATUSES);
  if (error) throw new Error(errorMessage);
}

/** Deletes provisional guest entries (and their pairs) reachable from the given participant ids. */
export async function removeProvisionalGuestEntries(
  db: Db,
  seedIds: string[],
  messages: {
    inspectPairs: string;
    inspectEntries: string;
    removePairs: string;
    removeEntries: string;
  },
) {
  const [{ data: pairsOne, error: pairsOneError }, { data: pairsTwo, error: pairsTwoError }] =
    await Promise.all([
      db
        .from('tournament_pairs')
        .select('player_one_id,player_two_id')
        .in('player_one_id', seedIds),
      db
        .from('tournament_pairs')
        .select('player_one_id,player_two_id')
        .in('player_two_id', seedIds),
    ]);
  if (pairsOneError || pairsTwoError) throw new Error(messages.inspectPairs);
  const relatedIds = [
    ...new Set([
      ...seedIds,
      ...(pairsOne ?? []).flatMap((pair) => [pair.player_one_id, pair.player_two_id]),
      ...(pairsTwo ?? []).flatMap((pair) => [pair.player_one_id, pair.player_two_id]),
    ]),
  ];
  const { data: relatedEntries, error: relatedError } = await db
    .from('tournament_participants')
    .select('id,user_id,status')
    .in('id', relatedIds);
  if (relatedError) throw new Error(messages.inspectEntries);
  const cleanupIds = (relatedEntries ?? [])
    .filter((entry) => entry.user_id === null && entry.status === 'provisional')
    .map((entry) => entry.id);
  const { error: deletePairsOneError } = await db
    .from('tournament_pairs')
    .delete()
    .in('player_one_id', cleanupIds);
  const { error: deletePairsTwoError } = await db
    .from('tournament_pairs')
    .delete()
    .in('player_two_id', cleanupIds);
  if (deletePairsOneError || deletePairsTwoError) throw new Error(messages.removePairs);
  const { error: deleteError } = await db
    .from('tournament_participants')
    .delete()
    .in('id', cleanupIds)
    .eq('status', 'provisional');
  if (deleteError) throw new Error(messages.removeEntries);
}
