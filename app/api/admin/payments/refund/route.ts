import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createPaymentServiceClient } from '@/lib/payments/server';
import { getStripeClient } from '@/lib/payments/stripe';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = await createSupabaseServerClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    const { data: profile } = await auth
      .from('profiles')
      .select('role,application_status')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.role !== 'admin' || profile.application_status !== 'approved')
      return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });

    const body = (await request.json()) as {
      paymentId?: string;
      amountMinor?: number;
      reason?: string;
      idempotencyKey?: string;
    };
    if (!body.paymentId)
      return NextResponse.json({ error: 'Payment ID is required.' }, { status: 400 });
    const db = createPaymentServiceClient();
    const { data: payment, error } = await db
      .from('payments')
      .select(
        'id,user_id,purpose,business_record_id,amount_minor,currency,status,refunded_amount_minor,stripe_payment_intent_id',
      )
      .eq('id', body.paymentId)
      .maybeSingle();
    if (error || !payment)
      return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
    if (
      !payment.stripe_payment_intent_id ||
      !['succeeded', 'partially_refunded'].includes(payment.status)
    ) {
      return NextResponse.json(
        { error: 'Only successfully paid Stripe payments can be refunded.' },
        { status: 409 },
      );
    }
    const remaining = payment.amount_minor - payment.refunded_amount_minor;
    const amount = body.amountMinor === undefined ? remaining : body.amountMinor;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
      return NextResponse.json(
        { error: 'Refund amount must be a positive amount no greater than the remaining balance.' },
        { status: 400 },
      );
    }
    const key = body.idempotencyKey?.trim();
    if (!key || key.length > 200)
      return NextResponse.json({ error: 'A refund idempotency key is required.' }, { status: 400 });
    const refund = await getStripeClient().refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        amount,
        reason:
          body.reason === 'duplicate' || body.reason === 'fraudulent'
            ? body.reason
            : 'requested_by_customer',
        metadata: { pctc_payment_id: payment.id, pctc_admin_user_id: user.id },
      },
      { idempotencyKey: `pctc-refund:${payment.id}:${key}` },
    );
    // Persist the returned Stripe refund immediately; the webhook remains the
    // authoritative retry/reconciliation path if this request is interrupted.
    const { error: refundRowError } = await db.from('payment_refunds').upsert(
      {
        payment_id: payment.id,
        stripe_refund_id: refund.id,
        amount_minor: refund.amount,
        currency: refund.currency.toLowerCase(),
        status: refund.status ?? 'pending',
        reason: refund.reason ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_refund_id' },
    );
    if (refundRowError)
      throw new Error('Stripe accepted the refund but its local record could not be saved.');
    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id, {
      expand: ['latest_charge'],
    });
    const chargeId =
      typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId, { expand: ['refunds.data'] });
      const refundedAmount = charge.amount_refunded;
      const fullyRefunded = refundedAmount >= payment.amount_minor;
      const nextStatus = fullyRefunded
        ? 'refunded'
        : refundedAmount > 0
          ? 'partially_refunded'
          : payment.status;
      const { error: paymentUpdateError } = await db
        .from('payments')
        .update({
          refunded_amount_minor: refundedAmount,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .in('status', ['succeeded', 'partially_refunded', 'refunded']);
      if (paymentUpdateError)
        throw new Error('Stripe accepted the refund but payment history could not be updated.');
      for (const stripeRefund of charge.refunds?.data ?? []) {
        const { error: syncError } = await db.from('payment_refunds').upsert(
          {
            payment_id: payment.id,
            stripe_refund_id: stripeRefund.id,
            amount_minor: stripeRefund.amount,
            currency: stripeRefund.currency.toLowerCase(),
            status: stripeRefund.status ?? 'pending',
            reason: stripeRefund.reason ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'stripe_refund_id' },
        );
        if (syncError) throw new Error('Could not synchronize refund history.');
      }
    }
    const { error: auditError } = await db.from('audit_logs').upsert(
      {
        actor_user_id: user.id,
        actor_label: 'admin',
        action: 'payment.refund_requested',
        outcome: 'success',
        target_table: 'payments',
        target_record_id: payment.id,
        source: 'admin_payment_refund',
        summary: `Refund requested for payment ${payment.id}.`,
        changes: { refundId: refund.id, amountMinor: amount, currency: payment.currency },
        idempotency_key: `payment:refund-request:${refund.id}`,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
    if (auditError)
      console.error('[Payments] Refund audit write failed', {
        paymentId: payment.id,
        refundId: refund.id,
      });
    return NextResponse.json({
      refundId: refund.id,
      status: refund.status,
      amountMinor: refund.amount,
      currency: refund.currency,
    });
  } catch (error) {
    console.error('[Payments] Refund request failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json(
      { error: 'Could not request refund. Check payment status and Stripe configuration.' },
      { status: 500 },
    );
  }
}
