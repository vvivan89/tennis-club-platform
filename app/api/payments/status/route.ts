import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createPaymentServiceClient } from '@/lib/payments/server';
import { getStripeClient } from '@/lib/payments/stripe';

export const runtime = 'nodejs';

type PaymentRow = {
  id: string;
  user_id: string | null;
  purpose: string;
  business_record_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  refunded_amount_minor: number;
  created_at: string;
  succeeded_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

async function reconcileCompletedCheckout(
  db: ReturnType<typeof createPaymentServiceClient>,
  payment: PaymentRow,
) {
  if (!payment.stripe_checkout_session_id) return payment;
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
  if (session.status !== 'complete' || session.payment_status !== 'paid') return payment;
  if (
    session.metadata?.pctc_payment_id !== payment.id ||
    session.metadata?.pctc_purpose !== payment.purpose ||
    session.metadata?.pctc_business_record_id !== payment.business_record_id ||
    (session.metadata?.pctc_user_id || null) !== payment.user_id ||
    session.client_reference_id !== payment.id ||
    session.mode !== 'payment' ||
    session.amount_total !== payment.amount_minor ||
    session.currency?.toLowerCase() !== payment.currency
  ) {
    throw new Error('Stripe Checkout Session does not match the local payment.');
  }
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) throw new Error('Paid Checkout Session has no PaymentIntent.');
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (
    intent.status !== 'succeeded' ||
    intent.amount !== payment.amount_minor ||
    intent.currency.toLowerCase() !== payment.currency ||
    intent.metadata?.pctc_payment_id !== payment.id ||
    intent.metadata?.pctc_purpose !== payment.purpose ||
    intent.metadata?.pctc_business_record_id !== payment.business_record_id ||
    (intent.metadata?.pctc_user_id || null) !== payment.user_id
  ) {
    throw new Error('Stripe PaymentIntent does not match the local payment.');
  }

  let current = payment;
  if (payment.status !== 'succeeded') {
    if (!['pending', 'processing', 'failed'].includes(payment.status)) {
      throw new Error(
        'Stripe confirms payment for a locally closed payment. Administrator review is required.',
      );
    }
    const now = new Date().toISOString();
    const { data: updated, error } = await db
      .from('payments')
      .update({
        status: 'succeeded',
        stripe_payment_intent_id: intent.id,
        succeeded_at: now,
        updated_at: now,
      })
      .eq('id', payment.id)
      .in('status', ['pending', 'processing', 'failed'])
      .select('id')
      .maybeSingle();
    if (error) throw new Error('Could not reconcile the confirmed Stripe payment.');
    if (!updated) {
      const { data: latest, error: latestError } = await db
        .from('payments')
        .select('status')
        .eq('id', payment.id)
        .maybeSingle();
      if (latestError || latest?.status !== 'succeeded') {
        throw new Error('Payment status changed while reconciling the Stripe confirmation.');
      }
    }
    current = {
      ...payment,
      status: 'succeeded',
      stripe_payment_intent_id: intent.id,
      succeeded_at: now,
    };
  }

  if (current.status === 'succeeded') {
    const { error } = await db.rpc('fulfill_successful_payment', { p_payment_id: payment.id });
    if (error)
      throw new Error(
        'Payment is confirmed but its membership or registration could not be finalized.',
      );
  }
  return current;
}

export async function GET(request: Request) {
  try {
    const auth = await createSupabaseServerClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    const params = new URL(request.url).searchParams;
    const sessionId = params.get('session_id');
    const paymentId = params.get('payment_id');
    const registrationId = params.get('registration_id');
    const isUuid = (value: string | null) =>
      Boolean(
        value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
      );
    if (
      (!sessionId || !sessionId.startsWith('cs_')) &&
      !isUuid(paymentId) &&
      !isUuid(registrationId)
    ) {
      return NextResponse.json(
        { error: 'A valid payment reference is required.' },
        { status: 400 },
      );
    }

    const db = createPaymentServiceClient();
    let query = db
      .from('payments')
      .select(
        'id,user_id,purpose,business_record_id,amount_minor,currency,status,refunded_amount_minor,created_at,succeeded_at,stripe_checkout_session_id,stripe_payment_intent_id',
      );
    if (registrationId) {
      query = query.eq('purpose', 'event_registration').eq('business_record_id', registrationId);
    } else if (sessionId) {
      query = query.eq('stripe_checkout_session_id', sessionId);
    } else {
      query = query.eq('id', paymentId!);
    }
    if (user) query = query.eq('user_id', user.id);
    else query = query.is('user_id', null).eq('purpose', 'tournament_registration');
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      if (registrationId) return NextResponse.json({ payment: null, fulfilled: false });
      return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
    }

    let payment = data as PaymentRow;
    if (!user && payment.purpose !== 'tournament_registration')
      return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
    if (payment.stripe_checkout_session_id) payment = await reconcileCompletedCheckout(db, payment);

    let fulfilled = false;
    if (payment.status === 'succeeded') {
      if (payment.purpose === 'membership' && payment.business_record_id) {
        if (payment.business_record_id.startsWith('family:')) {
          const familyId = payment.business_record_id.slice('family:'.length);
          const { data: family } = await db
            .from('membership_families')
            .select('paid_at,payment_id')
            .eq('id', familyId)
            .maybeSingle();
          fulfilled = Boolean(family && family.payment_id === payment.id && family.paid_at);
        } else {
          const { data: membership } = await db
            .from('memberships')
            .select('status,payment_status')
            .eq('id', payment.business_record_id)
            .eq('user_id', user?.id ?? '')
            .maybeSingle();
          fulfilled = Boolean(
            membership?.status === 'active' && membership.payment_status === 'paid',
          );
        }
      } else if (payment.purpose === 'event_registration' && payment.business_record_id) {
        const { data: registration } = await db
          .from('registrations')
          .select('status,payment_status')
          .eq('id', payment.business_record_id)
          .eq('user_id', user?.id ?? '')
          .maybeSingle();
        fulfilled = Boolean(
          registration?.status === 'confirmed' && registration.payment_status === 'paid',
        );
      } else if (payment.purpose === 'tournament_registration' && payment.business_record_id) {
        const participantIds = payment.business_record_id.split(',').filter(Boolean);
        const { data: participants } = await db
          .from('tournament_participants')
          .select('id,payment_id,payment_status')
          .in('id', participantIds);
        fulfilled =
          participantIds.length > 0 &&
          participantIds.every((id) =>
            (participants ?? []).some(
              (participant) =>
                participant.id === id &&
                participant.payment_id === payment.id &&
                participant.payment_status === 'paid',
            ),
          );
      }
    }

    let checkoutUrl: string | null = null;
    if (registrationId && payment.status === 'pending' && payment.stripe_checkout_session_id) {
      const session = await getStripeClient().checkout.sessions.retrieve(
        payment.stripe_checkout_session_id,
      );
      if (session.status === 'open' && session.url) checkoutUrl = session.url;
    }
    return NextResponse.json({
      payment: {
        id: payment.id,
        purpose: payment.purpose,
        business_record_id: payment.business_record_id,
        amount_minor: payment.amount_minor,
        currency: payment.currency,
        status: payment.status,
        refunded_amount_minor: payment.refunded_amount_minor,
        created_at: payment.created_at,
        succeeded_at: payment.succeeded_at,
      },
      fulfilled,
      checkoutUrl,
    });
  } catch (error) {
    console.error('[Payments] Status lookup failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Could not retrieve payment status.' }, { status: 500 });
  }
}
