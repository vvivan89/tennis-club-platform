import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createPaymentServiceClient } from '@/lib/payments/server';
import { markPaymentSucceeded } from '@/lib/payments/checkout-cleanup';
import { getStripeClient } from '@/lib/payments/stripe';
import { escapeHtml, sendResendEmail } from '@/lib/resend';
import { isCronAuthorized } from '@/lib/api-helpers';
import { getSiteOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const HOUR = 60 * MINUTE;
const REMINDER_WINDOW = 5 * MINUTE;

type Registration = {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  payment_status: string;
  amount_cents: number;
};

type Payment = {
  id: string;
  user_id: string | null;
  purpose: string;
  business_record_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  refunded_amount_minor: number | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

type EventRow = {
  id: string;
  slug: string | null;
  title: string;
  registration_closes_at: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  email_registration_reminders: boolean | null;
};

function checkoutMatchesPayment(session: Stripe.Checkout.Session, payment: Payment) {
  return (
    session.mode === 'payment' &&
    session.metadata?.pctc_payment_id === payment.id &&
    session.metadata?.pctc_purpose === payment.purpose &&
    session.metadata?.pctc_business_record_id === payment.business_record_id &&
    session.metadata?.pctc_user_id === payment.user_id &&
    session.client_reference_id === payment.id &&
    session.amount_total === payment.amount_minor &&
    session.currency?.toLowerCase() === payment.currency.toLowerCase()
  );
}

function intentMatchesPayment(intent: Stripe.PaymentIntent, payment: Payment) {
  return (
    intent.status === 'succeeded' &&
    intent.amount === payment.amount_minor &&
    intent.currency.toLowerCase() === payment.currency.toLowerCase() &&
    intent.metadata?.pctc_payment_id === payment.id &&
    intent.metadata?.pctc_purpose === payment.purpose &&
    intent.metadata?.pctc_business_record_id === payment.business_record_id &&
    intent.metadata?.pctc_user_id === payment.user_id
  );
}

/**
 * Re-checks Stripe immediately before reminders/removal. This avoids removing a
 * member merely because a successful Checkout webhook has not arrived yet.
 * Throws on Stripe/API uncertainty; the caller then retries on the next cron run.
 */
async function reconcileRegistrationPayment(
  db: ReturnType<typeof createPaymentServiceClient>,
  registration: Registration,
  payments: Payment[],
  cutoffHasPassed: boolean,
): Promise<boolean> {
  for (const payment of payments) {
    if (
      ['succeeded', 'partially_refunded'].includes(payment.status) &&
      (payment.refunded_amount_minor ?? 0) < payment.amount_minor
    ) {
      const { error: fulfillError } = await db.rpc('fulfill_successful_payment', {
        p_payment_id: payment.id,
      });
      if (fulfillError) throw new Error(`Could not fulfill payment ${payment.id}.`);
      return true;
    }

    if (!['pending', 'processing', 'failed'].includes(payment.status)) continue;
    if (!payment.stripe_checkout_session_id && !payment.stripe_payment_intent_id) continue;

    const stripe = getStripeClient();
    let intent: Stripe.PaymentIntent | null = null;

    if (payment.stripe_checkout_session_id) {
      const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
      if (!checkoutMatchesPayment(session, payment)) {
        throw new Error(`Stripe Checkout Session does not match payment ${payment.id}.`);
      }
      if (session.status === 'open' && cutoffHasPassed) {
        try {
          await stripe.checkout.sessions.expire(session.id);
        } catch (error) {
          // A concurrent completion can make expiration fail. Re-read the session
          // before deciding whether this registration is unpaid.
          const refreshed = await stripe.checkout.sessions.retrieve(session.id);
          if (refreshed.payment_status === 'paid' && refreshed.status === 'complete') {
            if (typeof refreshed.payment_intent === 'string') {
              intent = await stripe.paymentIntents.retrieve(refreshed.payment_intent);
            } else if (refreshed.payment_intent) {
              intent = refreshed.payment_intent;
            }
          } else if (refreshed.status === 'open') {
            throw error;
          }
        }
      }
      if (session.status === 'complete' && session.payment_status === 'paid') {
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
        if (!paymentIntentId)
          throw new Error(`Paid Checkout Session ${session.id} has no PaymentIntent.`);
        intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      }
    } else if (payment.stripe_payment_intent_id) {
      intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
    }

    if (intent && intentMatchesPayment(intent, payment)) {
      const { error: updateError } = await markPaymentSucceeded(db, payment.id, intent.id);
      if (updateError) throw new Error(`Could not reconcile payment ${payment.id}.`);
      const { error: fulfillError } = await db.rpc('fulfill_successful_payment', {
        p_payment_id: payment.id,
      });
      if (fulfillError) throw new Error(`Could not fulfill payment ${payment.id}.`);
      return true;
    }
  }

  // The registration itself is the business record. If fulfillment already
  // completed, trust that authoritative marker even if the old payment row is
  // no longer available in this query.
  const { data: current, error } = await db
    .from('registrations')
    .select('payment_status,status')
    .eq('id', registration.id)
    .maybeSingle();
  if (error) throw new Error(`Could not re-check registration ${registration.id}.`);
  return current?.status === 'confirmed' && current.payment_status === 'paid';
}

async function claimReminder(
  db: ReturnType<typeof createPaymentServiceClient>,
  registration: Registration,
  reminderType: '24h' | '1h',
): Promise<string | null> {
  const { data, error } = await db
    .from('event_registration_payment_reminders')
    .insert({
      registration_id: registration.id,
      event_id: registration.event_id,
      user_id: registration.user_id,
      reminder_type: reminderType,
    })
    .select('id')
    .maybeSingle();
  if (!error && data?.id) return data.id;
  if (error?.code !== '23505') throw new Error('Could not record payment reminder attempt.');

  const { data: existing, error: existingError } = await db
    .from('event_registration_payment_reminders')
    .select('id,created_at,sent_at')
    .eq('registration_id', registration.id)
    .eq('reminder_type', reminderType)
    .maybeSingle();
  if (existingError || !existing) return null;
  if (existing.sent_at) return null;
  const staleBefore = Date.now() - 10 * MINUTE;
  if (new Date(existing.created_at).getTime() > staleBefore) return null;
  await db
    .from('event_registration_payment_reminders')
    .delete()
    .eq('id', existing.id)
    .is('sent_at', null);
  const retry = await db
    .from('event_registration_payment_reminders')
    .insert({
      registration_id: registration.id,
      event_id: registration.event_id,
      user_id: registration.user_id,
      reminder_type: reminderType,
    })
    .select('id')
    .maybeSingle();
  return retry.error ? null : (retry.data?.id ?? null);
}

async function sendReminder(
  request: Request,
  db: ReturnType<typeof createPaymentServiceClient>,
  registration: Registration,
  event: EventRow,
  reminderType: '24h' | '1h',
  recipient: {
    email: string | null;
    full_name: string | null;
    email_registration_reminders: boolean | null;
  },
): Promise<'sent' | 'skipped' | 'failed'> {
  if (!recipient.email || recipient.email_registration_reminders === false) return 'skipped';
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM;
  if (!resendKey || !fromEmail) return 'failed';
  const claimId = await claimReminder(db, registration, reminderType);
  if (!claimId) return 'skipped';

  const cutoff = new Date(event.registration_closes_at!).toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Vancouver',
  });
  const eventUrl = new URL(`/events/${event.slug || event.id}`, getSiteOrigin(request)).toString();
  const timeText = reminderType === '24h' ? 'about 24 hours' : 'about one hour';
  const subject =
    reminderType === '24h'
      ? `Payment required to keep your place: ${event.title}`
      : `Final reminder: event payment due soon — ${event.title}`;
  const html = `<p>Hello ${escapeHtml(recipient.full_name || 'member')},</p><p>Your registration for <strong>${escapeHtml(event.title)}</strong> is awaiting payment. The registration cutoff is ${escapeHtml(cutoff)} (Pacific time), in ${timeText}.</p><p>If payment is not confirmed by the cutoff, your registration will be removed and your place may be given to another member.</p><p><a href="${escapeHtml(eventUrl)}">Complete or check your event payment</a></p><p>Port Coquitlam Tennis Club</p>`;
  try {
    const response = await sendResendEmail({
      request,
      apiKey: resendKey,
      from: fromEmail,
      to: recipient.email,
      subject,
      html,
    });
    if (!response.ok) {
      await db.from('event_registration_payment_reminders').delete().eq('id', claimId);
      return 'failed';
    }
    await db
      .from('event_registration_payment_reminders')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', claimId);
    return 'sent';
  } catch {
    await db.from('event_registration_payment_reminders').delete().eq('id', claimId);
    return 'failed';
  }
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: 'Supabase service configuration is missing.' },
      { status: 503 },
    );
  }

  const db = createPaymentServiceClient();
  const now = new Date();
  const { data: events, error: eventsError } = await db
    .from('events')
    .select('id,slug,title,registration_closes_at')
    .eq('status', 'published')
    .not('registration_closes_at', 'is', null)
    .lte('registration_closes_at', new Date(now.getTime() + DAY + HOUR).toISOString());
  if (eventsError)
    return NextResponse.json({ error: 'Could not load event cutoffs.' }, { status: 500 });

  let remindersSent = 0;
  let remindersFailed = 0;
  let removed = 0;
  let errors = 0;

  for (const event of (events ?? []) as EventRow[]) {
    if (!event.registration_closes_at) continue;
    const cutoff = new Date(event.registration_closes_at).getTime();
    const cutoffHasPassed = now.getTime() >= cutoff;
    const { data: registrations, error: registrationsError } = await db
      .from('registrations')
      .select('id,event_id,user_id,status,payment_status,amount_cents')
      .eq('event_id', event.id)
      .eq('status', 'confirmed')
      .in('payment_status', ['pending', 'failed']);
    if (registrationsError) {
      errors++;
      continue;
    }
    const pendingRegistrations = (registrations ?? []) as Registration[];
    if (!pendingRegistrations.length) continue;

    const registrationIds = pendingRegistrations.map((registration) => registration.id);
    const { data: paymentRows, error: paymentsError } = await db
      .from('payments')
      .select(
        'id,user_id,purpose,business_record_id,amount_minor,currency,status,refunded_amount_minor,stripe_checkout_session_id,stripe_payment_intent_id',
      )
      .eq('purpose', 'event_registration')
      .in('business_record_id', registrationIds);
    if (paymentsError) {
      errors++;
      continue;
    }
    const paymentsByRegistration = new Map<string, Payment[]>();
    for (const payment of (paymentRows ?? []) as Payment[]) {
      if (!payment.business_record_id) continue;
      const list = paymentsByRegistration.get(payment.business_record_id) ?? [];
      list.push(payment);
      paymentsByRegistration.set(payment.business_record_id, list);
    }

    const profileIds = [
      ...new Set(pendingRegistrations.map((registration) => registration.user_id)),
    ];
    const { data: profiles, error: profilesError } = await db
      .from('profiles')
      .select('id,email,full_name,email_registration_reminders')
      .in('id', profileIds);
    if (profilesError) {
      errors++;
      continue;
    }
    const profileById = new Map<string, ProfileRow>(
      ((profiles ?? []) as ProfileRow[]).map(
        (profile) => [profile.id, profile] as [string, ProfileRow],
      ),
    );

    for (const registration of pendingRegistrations) {
      const untilCutoff = cutoff - now.getTime();
      const reminderType: '24h' | '1h' | null =
        Math.abs(untilCutoff - DAY) <= REMINDER_WINDOW
          ? '24h'
          : Math.abs(untilCutoff - HOUR) <= REMINDER_WINDOW
            ? '1h'
            : null;
      // Stripe reconciliation is needed at reminder time and cutoff, not on
      // every cron tick throughout the full day before the cutoff.
      if (!cutoffHasPassed && !reminderType) continue;

      const payments = paymentsByRegistration.get(registration.id) ?? [];
      let paid = false;
      try {
        paid = await reconcileRegistrationPayment(db, registration, payments, cutoffHasPassed);
      } catch (error) {
        console.error('[Pending event payments] Could not reconcile registration payment', {
          registrationId: registration.id,
          message: error instanceof Error ? error.message : 'unknown',
        });
        errors++;
        // If Stripe or the database is uncertain, do not remove the member.
        continue;
      }
      if (paid) continue;

      if (cutoffHasPassed) {
        const { data: updated, error: updateError } = await db
          .from('registrations')
          .update({
            status: 'cancelled',
            payment_status: 'failed',
            queue_position: null,
            updated_at: now.toISOString(),
          })
          .eq('id', registration.id)
          .eq('status', 'confirmed')
          .in('payment_status', ['pending', 'failed'])
          .select('id')
          .maybeSingle();
        if (updateError) errors++;
        else if (updated) removed++;
        continue;
      }

      if (!reminderType) continue;
      const profile = profileById.get(registration.user_id);
      if (!profile) continue;
      const result = await sendReminder(request, db, registration, event, reminderType, profile);
      if (result === 'sent') remindersSent++;
      if (result === 'failed') remindersFailed++;
    }
  }

  return NextResponse.json({
    success: errors === 0 && remindersFailed === 0,
    remindersSent,
    remindersFailed,
    registrationsRemoved: removed,
    errors,
    checkedAt: now.toISOString(),
  });
}
