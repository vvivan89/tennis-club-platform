import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripeClient, getStripeWebhookSecret } from '@/lib/payments/stripe';
import { createPaymentServiceClient } from '@/lib/payments/server';
import { syncPaymentProceeds } from '@/lib/payments/proceeds';
import { removeProvisionalGuestEntries } from '@/lib/payments/checkout-cleanup';
import { upsertStripeRefund } from '@/lib/payments/refund-records';
import {
  calculateRefundState,
  mapStripePaymentStatus,
  type PaymentStatus,
} from '@/lib/payments/core';

export const runtime = 'nodejs';

const handledTypes = new Set([
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  'checkout.session.expired',
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing Stripe signature.' }, { status: 400 });

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());
  } catch {
    return NextResponse.json(
      { error: 'Invalid webhook signature or Stripe configuration.' },
      { status: 400 },
    );
  }

  if (!handledTypes.has(event.type)) return NextResponse.json({ received: true, ignored: true });

  let db: ReturnType<typeof createPaymentServiceClient>;
  try {
    db = createPaymentServiceClient();
  } catch {
    return NextResponse.json({ error: 'Payment storage is unavailable.' }, { status: 503 });
  }

  const claim = await db.rpc('claim_stripe_webhook_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_livemode: event.livemode,
  });
  if (claim.error) {
    console.error('Stripe webhook event claim failed', {
      eventId: event.id,
      eventType: event.type,
    });
    return NextResponse.json({ error: 'Could not safely claim webhook event.' }, { status: 500 });
  }
  if (claim.data !== true) return NextResponse.json({ received: true, duplicate: true });

  try {
    if (event.type === 'charge.refunded') {
      await recordChargeRefund(db, event.data.object as Stripe.Charge, event.id);
    } else if (event.type === 'checkout.session.expired') {
      await recordExpiredCheckout(db, event.data.object as Stripe.Checkout.Session, event.id);
    } else if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      await recordCompletedCheckout(db, event.data.object as Stripe.Checkout.Session, event.id);
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await recordFailedCheckout(db, event.data.object as Stripe.Checkout.Session, event.id);
    } else {
      await recordPaymentIntent(
        db,
        event.data.object as Stripe.PaymentIntent,
        event.type,
        event.id,
      );
    }
    const { error } = await db
      .from('stripe_webhook_events')
      .update({
        processing_status: 'processed',
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('stripe_event_id', event.id);
    if (error) throw new Error('Could not mark webhook event as processed.');
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown webhook processing failure.';
    await db
      .from('stripe_webhook_events')
      .update({
        processing_status: 'failed',
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_event_id', event.id);
    await db.from('audit_logs').upsert(
      {
        actor_label: 'stripe',
        action: 'stripe.webhook_processing_failed',
        outcome: 'failure',
        target_table: 'stripe_webhook_events',
        target_record_id: event.id,
        source: 'stripe_webhook',
        summary: 'Stripe webhook processing failed and can be retried.',
        metadata: { stripeEventType: event.type, error: message.slice(0, 300) },
        idempotency_key: `stripe:${event.id}:processing_failed`,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
    console.error('Stripe webhook processing failed', {
      eventId: event.id,
      eventType: event.type,
      message,
    });
    return NextResponse.json(
      { error: 'Webhook processing failed; retry is safe.' },
      { status: 500 },
    );
  }
}

async function recordCompletedCheckout(
  db: ReturnType<typeof createPaymentServiceClient>,
  session: Stripe.Checkout.Session,
  eventId: string,
) {
  const paymentId = session.metadata?.pctc_payment_id;
  if (!paymentId) throw new Error('Completed Checkout Session has no internal payment reference.');
  const { data: payment, error } = await db
    .from('payments')
    .select(
      'id,status,amount_minor,currency,purpose,business_record_id,user_id,stripe_checkout_session_id',
    )
    .eq('id', paymentId)
    .maybeSingle();
  if (error || !payment) throw new Error('Completed Checkout Session payment was not found.');
  if (payment.stripe_checkout_session_id && payment.stripe_checkout_session_id !== session.id) {
    throw new Error('Completed Checkout Session does not match the stored session reference.');
  }
  if (
    session.mode !== 'payment' ||
    session.metadata?.pctc_purpose !== payment.purpose ||
    session.metadata?.pctc_business_record_id !== payment.business_record_id ||
    (session.metadata?.pctc_user_id || null) !== payment.user_id ||
    session.client_reference_id !== payment.id ||
    (session.amount_total !== null && session.amount_total !== payment.amount_minor) ||
    (session.currency && session.currency.toLowerCase() !== payment.currency)
  ) {
    throw new Error('Completed Checkout Session does not match the local payment.');
  }

  // A completed session can still be awaiting an asynchronous payment method.
  // The async_payment_succeeded event will confirm it later.
  if (session.payment_status !== 'paid') return;
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) throw new Error('Paid Checkout Session has no PaymentIntent.');
  const intent = await getStripeClient().paymentIntents.retrieve(paymentIntentId);
  if (intent.status !== 'succeeded') {
    throw new Error('Checkout reports a paid session but the PaymentIntent is not succeeded yet.');
  }
  await recordPaymentIntent(db, intent, 'payment_intent.succeeded', eventId);
}

async function recordFailedCheckout(
  db: ReturnType<typeof createPaymentServiceClient>,
  session: Stripe.Checkout.Session,
  eventId: string,
) {
  const paymentId = session.metadata?.pctc_payment_id;
  if (!paymentId) throw new Error('Failed Checkout Session has no internal payment reference.');
  const { data: payment, error } = await db
    .from('payments')
    .select('id,purpose,business_record_id,user_id,stripe_checkout_session_id')
    .eq('id', paymentId)
    .maybeSingle();
  if (error || !payment) throw new Error('Failed Checkout Session payment was not found.');
  if (
    (payment.stripe_checkout_session_id && payment.stripe_checkout_session_id !== session.id) ||
    session.metadata?.pctc_purpose !== payment.purpose ||
    session.metadata?.pctc_business_record_id !== payment.business_record_id ||
    (session.metadata?.pctc_user_id || null) !== payment.user_id
  ) {
    throw new Error('Failed Checkout Session does not match the local payment.');
  }
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) {
    // There may be no PaymentIntent when checkout was abandoned before payment began.
    return;
  }
  const intent = await getStripeClient().paymentIntents.retrieve(paymentIntentId);
  await recordPaymentIntent(db, intent, 'payment_intent.payment_failed', eventId);
}

async function recordPaymentIntent(
  db: ReturnType<typeof createPaymentServiceClient>,
  intent: Stripe.PaymentIntent,
  eventType: string,
  eventId: string,
) {
  const paymentId = intent.metadata?.pctc_payment_id;
  if (!paymentId) throw new Error('Payment intent has no internal payment reference.');
  const { data: payment, error: lookupError } = await db
    .from('payments')
    .select(
      'id,status,amount_minor,currency,stripe_payment_intent_id,last_stripe_event_id,purpose,business_record_id,user_id',
    )
    .eq('id', paymentId)
    .maybeSingle();
  if (lookupError || !payment) throw new Error('Referenced payment record was not found.');
  if (payment.stripe_payment_intent_id && payment.stripe_payment_intent_id !== intent.id) {
    throw new Error('Payment intent does not match the stored Stripe reference.');
  }
  if (
    intent.metadata?.pctc_purpose !== payment.purpose ||
    intent.metadata?.pctc_business_record_id !== payment.business_record_id ||
    (intent.metadata?.pctc_user_id || null) !== payment.user_id
  ) {
    throw new Error(
      'Stripe metadata does not match the internal payment purpose, owner, or business record.',
    );
  }
  if (
    payment.amount_minor !== intent.amount ||
    payment.currency !== intent.currency.toLowerCase()
  ) {
    throw new Error('Stripe amount or currency does not match the payment record.');
  }
  const next = mapStripePaymentStatus(eventType, payment.status as PaymentStatus);
  if (!next) {
    if (payment.status === 'succeeded') {
      await fulfillPayment(db, payment.id);
      await syncPaymentProceeds(db, payment.id, intent.id);
    }
    if (payment.last_stripe_event_id === eventId) {
      await writePaymentAudit(db, payment.id, `payment.${payment.status}`, eventId, {
        status: payment.status,
      });
    }
    return;
  }
  const timestamp = new Date().toISOString();
  const { data: updated, error } = await db
    .from('payments')
    .update({
      status: next,
      stripe_payment_intent_id: intent.id,
      ...(next === 'succeeded' ? { succeeded_at: timestamp } : {}),
      ...(next === 'failed'
        ? {
            failed_at: timestamp,
            failure_code: intent.last_payment_error?.code ?? null,
            failure_message: intent.last_payment_error
              ? 'Payment failed. See the Stripe dashboard for diagnostic details.'
              : null,
          }
        : {}),
      ...(next === 'canceled' ? { canceled_at: timestamp } : {}),
      updated_at: timestamp,
      last_stripe_event_id: eventId,
    })
    .eq('id', payment.id)
    .eq('status', payment.status)
    .select('id')
    .maybeSingle();
  if (error || !updated)
    throw new Error('Payment state changed concurrently; retry webhook processing.');
  await writePaymentAudit(db, payment.id, `payment.${next}`, eventId, {
    from: payment.status,
    to: next,
  });
  if (next === 'succeeded') {
    await fulfillPayment(db, payment.id);
    await syncPaymentProceeds(db, payment.id, intent.id);
  }
}

async function fulfillPayment(
  db: ReturnType<typeof createPaymentServiceClient>,
  paymentId: string,
) {
  const { error } = await db.rpc('fulfill_successful_payment', { p_payment_id: paymentId });
  if (error) throw new Error(`Could not fulfill the paid business record: ${error.message}`);
}

async function recordExpiredCheckout(
  db: ReturnType<typeof createPaymentServiceClient>,
  session: Stripe.Checkout.Session,
  eventId: string,
) {
  const paymentId = session.metadata?.pctc_payment_id;
  if (!paymentId) throw new Error('Expired Checkout Session has no internal payment reference.');
  const { data: payment, error: lookupError } = await db
    .from('payments')
    .select('id,status,purpose,business_record_id,user_id,stripe_checkout_session_id')
    .eq('id', paymentId)
    .maybeSingle();
  if (lookupError || !payment) throw new Error('Expired Checkout Session payment was not found.');
  if (payment.stripe_checkout_session_id && payment.stripe_checkout_session_id !== session.id) {
    throw new Error('Expired Checkout Session does not match the stored Stripe reference.');
  }
  if (
    session.metadata?.pctc_purpose !== payment.purpose ||
    session.metadata?.pctc_business_record_id !== payment.business_record_id ||
    (session.metadata?.pctc_user_id || null) !== payment.user_id
  ) {
    throw new Error('Expired Checkout Session metadata does not match the internal payment.');
  }
  if (['succeeded', 'partially_refunded', 'refunded'].includes(payment.status)) return;
  if (['pending', 'processing', 'failed'].includes(payment.status)) {
    const { data: canceledPayment, error } = await db
      .from('payments')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_stripe_event_id: eventId,
      })
      .eq('id', payment.id)
      .in('status', ['pending', 'processing', 'failed'])
      .select('id')
      .maybeSingle();
    if (error) throw new Error('Could not cancel the expired payment.');
    if (!canceledPayment) {
      const { data: latestPayment, error: latestError } = await db
        .from('payments')
        .select('status')
        .eq('id', payment.id)
        .maybeSingle();
      if (latestError)
        throw new Error('Could not verify the payment status after checkout expiration.');
      if (
        latestPayment &&
        ['succeeded', 'partially_refunded', 'refunded'].includes(latestPayment.status)
      )
        return;
    }
  }
  if (
    payment.purpose === 'tournament_registration' &&
    !payment.user_id &&
    payment.business_record_id
  ) {
    const ids = payment.business_record_id.split(',').filter(Boolean);
    const { data: guestEntries, error: guestEntriesError } = await db
      .from('tournament_participants')
      .select('id,user_id,status')
      .in('id', ids);
    if (guestEntriesError)
      throw new Error('Could not inspect provisional guest entries after checkout expiry.');
    const provisionalIds = (guestEntries ?? [])
      .filter((entry) => entry.user_id === null && entry.status === 'provisional')
      .map((entry) => entry.id);
    if (provisionalIds.length) {
      await removeProvisionalGuestEntries(db, provisionalIds, {
        inspectPairs: 'Could not inspect provisional tournament pairs after checkout expiry.',
        inspectEntries: 'Could not inspect provisional tournament entries after checkout expiry.',
        removePairs: 'Could not remove provisional tournament pairs after checkout expiry.',
        removeEntries: 'Could not remove provisional tournament entries after checkout expiry.',
      });
    }
  }
  await writePaymentAudit(db, payment.id, 'payment.canceled', eventId, {
    reason: 'checkout_session_expired',
  });
}

async function recordChargeRefund(
  db: ReturnType<typeof createPaymentServiceClient>,
  charge: Stripe.Charge,
  eventId: string,
) {
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) throw new Error('Refunded charge has no payment intent reference.');
  const { data: payment, error } = await db
    .from('payments')
    .select('id,amount_minor,currency,status,refunded_amount_minor')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error || !payment) throw new Error('Refunded charge does not match a local payment.');
  if (
    charge.amount !== payment.amount_minor ||
    charge.currency.toLowerCase() !== payment.currency
  ) {
    throw new Error('Refunded charge amount or currency does not match the payment record.');
  }
  const currentCharge = await getStripeClient().charges.retrieve(charge.id, {
    expand: ['refunds.data'],
  });
  for (const refund of currentCharge.refunds?.data ?? []) {
    const refundError = await upsertStripeRefund(db, payment.id, refund, {
      last_stripe_event_id: eventId,
    });
    if (refundError) throw new Error('Could not persist refund record.');
  }
  const refundState = calculateRefundState(
    payment.status as PaymentStatus,
    payment.amount_minor,
    payment.refunded_amount_minor,
    currentCharge.amount_refunded,
  );
  const refunded = refundState.refundedAmountMinor;
  const next: PaymentStatus = refundState.status;
  const { data: updated, error: updateError } = await db
    .from('payments')
    .update({
      status: next,
      refunded_amount_minor: refunded,
      updated_at: new Date().toISOString(),
      last_stripe_event_id: eventId,
    })
    .eq('id', payment.id)
    .in('status', ['succeeded', 'partially_refunded', 'refunded'])
    .select('id')
    .maybeSingle();
  if (updateError || !updated) throw new Error('Could not update refunded payment state.');
  await writePaymentAudit(db, payment.id, `payment.${next}`, eventId, {
    refundedAmountMinor: refunded,
  });
}

async function writePaymentAudit(
  db: ReturnType<typeof createPaymentServiceClient>,
  paymentId: string,
  action: string,
  eventId: string,
  changes: Record<string, unknown>,
) {
  const { error } = await db.from('audit_logs').upsert(
    {
      actor_label: 'stripe',
      action,
      outcome: 'success',
      target_table: 'payments',
      target_record_id: paymentId,
      source: 'stripe_webhook',
      summary: `Stripe confirmed ${action.replace('payment.', 'payment ')}.`,
      changes,
      metadata: { stripeEventId: eventId },
      idempotency_key: `stripe:${eventId}:${action}`,
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true },
  );
  if (error) throw new Error('Could not write payment audit record.');
}
