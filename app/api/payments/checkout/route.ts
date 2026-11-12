import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sendResendEmail } from '@/lib/resend';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { getSiteOrigin } from '@/lib/site-url';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getSignedInUser } from '@/lib/api-helpers';
import { canceledPaymentPatch } from '@/lib/payments/checkout-cleanup';
import { createPendingPayment } from '@/lib/payments/server';
import { getStripeClient } from '@/lib/payments/stripe';
import { resolveCheckoutTarget } from '@/lib/payments/checkout-target';
import { getCheckoutServiceClient, type CheckoutBody } from '@/lib/payments/checkout-route-helpers';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { user } = await getSignedInUser();
    const limited = await enforceRateLimit(request, {
      name: 'checkout',
      limit: 30,
      windowSeconds: 600,
      userId: user?.id,
    });
    if (limited) return limited;
    const body = (await request.json()) as CheckoutBody;
    if (!user) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    }
    if (
      !body.purpose ||
      !['membership', 'event_registration', 'tournament_registration'].includes(body.purpose)
    ) {
      return NextResponse.json({ error: 'Unsupported payment purpose.' }, { status: 400 });
    }
    const idempotencyKey = body.idempotencyKey?.trim() || randomUUID();
    if (idempotencyKey.length > 200)
      return NextResponse.json({ error: 'Invalid payment request key.' }, { status: 400 });

    const db = getCheckoutServiceClient();
    const [{ data: profile }, { data: settings, error: settingsError }] = await Promise.all([
      user
        ? db
            .from('profiles')
            .select('id,email,full_name,application_status,account_kind')
            .eq('id', user!.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from('membership_plan_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const eventOnlyTournamentPayer =
      body.purpose === 'tournament_registration' &&
      profile?.account_kind === 'event_guest' &&
      Boolean(
        user?.email &&
        user.email_confirmed_at &&
        profile.email?.toLowerCase() === user.email.toLowerCase(),
      );
    if (!profile || (profile.application_status !== 'approved' && !eventOnlyTournamentPayer)) {
      return NextResponse.json(
        { error: 'An approved member profile is required to make a payment.' },
        { status: 403 },
      );
    }
    if (settingsError) throw new Error('Could not load membership pricing settings.');

    const target = await resolveCheckoutTarget({ db, body, user, settings });
    if (target instanceof NextResponse) return target;
    const { businessRecordId, amountMinor, currency, description } = target;
    const customerEmail = profile?.email || user?.email || undefined;

    if (body.purpose === 'tournament_registration') {
      const selectedIds = businessRecordId.split(',').filter(Boolean);
      const { data: activeTournamentPayments, error: activeTournamentPaymentsError } = await db
        .from('payments')
        .select('id,user_id,business_record_id,status')
        .eq('purpose', 'tournament_registration')
        .in('status', ['pending', 'processing', 'succeeded']);
      if (activeTournamentPaymentsError)
        throw new Error('Could not check overlapping tournament payment attempts.');
      const overlap = (activeTournamentPayments ?? []).find((candidate) => {
        const candidateIds = (candidate.business_record_id || '').split(',').filter(Boolean);
        const sharesEntry = selectedIds.some((id) => candidateIds.includes(id));
        const samePaymentScope =
          candidate.business_record_id === businessRecordId &&
          candidate.user_id === (user?.id ?? null);
        return sharesEntry && !samePaymentScope;
      });
      if (overlap)
        return NextResponse.json(
          {
            error:
              'A payment attempt is already active for one of these entries. Refresh and check payment status before starting another payment.',
          },
          { status: 409 },
        );
    }

    if (body.provider === 'interac') {
      const { data: methodSettings, error: methodSettingsError } = await db
        .from('payment_method_settings')
        .select('interac_enabled,interac_recipient_email,interac_instructions')
        .eq('id', 1)
        .maybeSingle();
      if (methodSettingsError) throw new Error('Could not load Interac payment settings.');
      if (!methodSettings?.interac_enabled || !methodSettings.interac_recipient_email.trim())
        return NextResponse.json(
          { error: 'Interac e-Transfer is not currently available.' },
          { status: 503 },
        );
      // The database permits only one active payment per business record across
      // all providers. Inspect that record before creating an Interac request so
      // a member can safely switch away from an abandoned Stripe Checkout.
      const { data: prior, error: priorError } = await db
        .from('payments')
        .select(
          'id,user_id,provider,amount_minor,currency,status,manual_review_status,stripe_checkout_session_id',
        )
        .eq('purpose', body.purpose)
        .eq('business_record_id', businessRecordId)
        .in('status', ['pending', 'processing', 'succeeded', 'partially_refunded', 'refunded'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priorError) throw new Error('Could not check existing payment requests.');

      let paymentId: string | undefined;
      let shouldSendInstructions = false;
      if (prior) {
        if (prior.user_id !== user!.id) {
          return NextResponse.json(
            {
              error:
                'An active payment already exists for this registration. Contact the club if you believe this is an error.',
            },
            { status: 409 },
          );
        }
        if (prior.amount_minor !== amountMinor || prior.currency?.toLowerCase() !== currency) {
          return NextResponse.json(
            { error: 'An existing payment request has a different amount. Contact the club.' },
            { status: 409 },
          );
        }
        if (
          prior.provider === 'interac' &&
          ['submitted', 'investigating'].includes(prior.manual_review_status || '') &&
          prior.status === 'pending'
        ) {
          paymentId = prior.id;
        } else if (prior.provider === 'stripe' && prior.status === 'pending') {
          if (!prior.stripe_checkout_session_id) {
            console.error(
              '[Payments] Cannot switch pending Stripe payment to Interac without a Checkout Session ID',
              { paymentId: prior.id },
            );
            return NextResponse.json(
              {
                error:
                  'A previous card checkout is still active. Refresh the page and try again in a few minutes, or contact the club if the problem continues.',
              },
              { status: 409 },
            );
          }
          const stripe = getStripeClient();
          let stripeSession;
          try {
            stripeSession = await stripe.checkout.sessions.retrieve(
              prior.stripe_checkout_session_id,
            );
          } catch (sessionError) {
            console.error(
              '[Payments] Could not inspect existing Stripe Checkout before switching to Interac',
              {
                paymentId: prior.id,
                message:
                  sessionError instanceof Error ? sessionError.message : 'Unknown Stripe error',
              },
            );
            return NextResponse.json(
              {
                error:
                  'Could not safely switch payment methods. Please try again or contact the club.',
              },
              { status: 409 },
            );
          }
          if (stripeSession.status === 'complete') {
            return NextResponse.json(
              {
                error:
                  'The existing card checkout has already been completed or is processing. Check your payment history before starting another payment.',
              },
              { status: 409 },
            );
          }
          if (stripeSession.status === 'open') {
            try {
              await stripe.checkout.sessions.expire(stripeSession.id);
            } catch (expireError) {
              console.error(
                '[Payments] Could not expire existing Stripe Checkout before switching to Interac',
                {
                  paymentId: prior.id,
                  sessionId: stripeSession.id,
                  message:
                    expireError instanceof Error ? expireError.message : 'Unknown Stripe error',
                },
              );
              return NextResponse.json(
                {
                  error:
                    'Could not safely close the existing card checkout. Please try again or contact the club.',
                },
                { status: 409 },
              );
            }
          } else if (stripeSession.status !== 'expired') {
            return NextResponse.json(
              {
                error:
                  'The existing card payment cannot safely be replaced yet. Check your payment history or contact the club.',
              },
              { status: 409 },
            );
          }
          const { data: canceled, error: cancelError } = await db
            .from('payments')
            .update(canceledPaymentPatch())
            .eq('id', prior.id)
            .eq('provider', 'stripe')
            .eq('status', 'pending')
            .select('id')
            .maybeSingle();
          if (cancelError)
            throw new Error(
              'The old card checkout was closed, but its payment record could not be updated. Retry safely.',
            );
          if (!canceled) {
            // Stripe's checkout.session.expired webhook can win this race and
            // mark the row canceled before this request updates it.
            const { data: latestPayment, error: latestPaymentError } = await db
              .from('payments')
              .select('status')
              .eq('id', prior.id)
              .maybeSingle();
            if (latestPaymentError)
              throw new Error('Could not verify the previous payment state. Retry safely.');
            if (!latestPayment || !['canceled', 'failed'].includes(latestPayment.status)) {
              return NextResponse.json(
                {
                  error:
                    'The payment state changed while switching methods. Refresh the page and check payment history before retrying.',
                },
                { status: 409 },
              );
            }
          }
          shouldSendInstructions = true;
        } else {
          return NextResponse.json(
            {
              error:
                'An active or completed payment already exists for this registration. Check your payment history before trying again.',
            },
            { status: 409 },
          );
        }
      } else {
        shouldSendInstructions = true;
      }

      if (!paymentId) {
        const { data: created, error: createError } = await db
          .from('payments')
          .insert({
            user_id: user!.id,
            purpose: body.purpose,
            business_record_id: businessRecordId,
            amount_minor: amountMinor,
            currency,
            status: 'pending',
            provider: 'interac',
            manual_review_status: 'submitted',
            manual_submitted_at: new Date().toISOString(),
            idempotency_key: `interac:${user!.id}:${body.purpose}:${businessRecordId}:${randomUUID()}`,
          })
          .select('id')
          .single();
        if (createError || !created) {
          // A concurrent request may have created the active payment after our lookup.
          // Keep diagnostics server-side and return a useful conflict for that race.
          console.error('[Payments] Interac payment insert failed', {
            code: createError?.code ?? null,
            message: createError?.message ?? (created ? null : 'Insert returned no row'),
            details: createError?.details ?? null,
            hint: createError?.hint ?? null,
            userId: user!.id,
            purpose: body.purpose,
            businessRecordId,
            amountMinor,
            currency,
          });
          if (createError?.code === '23505') {
            return NextResponse.json(
              {
                error:
                  'An active payment request already exists for this registration. Refresh the page and check payment history before retrying.',
              },
              { status: 409 },
            );
          }
          throw new Error('Could not create Interac payment request.');
        }
        paymentId = created.id;
        const { error: auditError } = await db.from('audit_logs').insert({
          actor_user_id: user!.id,
          actor_label: profile?.full_name || 'member',
          action: 'payment.interac_submitted',
          outcome: 'success',
          target_table: 'payments',
          target_record_id: paymentId,
          source: 'interac_payment',
          summary: `Interac payment submitted for ${body.purpose}.`,
          changes: { amountMinor, currency, purpose: body.purpose },
          idempotency_key: `payment:interac-submitted:${paymentId}`,
        });
        if (auditError)
          console.error('[Payments] Interac audit write failed', {
            paymentId,
            message: auditError.message,
          });
      }
      if (
        shouldSendInstructions &&
        profile?.email &&
        process.env.RESEND_API_KEY &&
        (process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM)
      ) {
        try {
          const { data: clubSettings } = await db
            .from('club_settings')
            .select('short_name')
            .eq('id', 1)
            .maybeSingle();
          const shortName = clubSettings?.short_name || 'Tennis Club';
          const from =
            process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM!;
          const emailResponse = await sendResendEmail({
            request,
            from,
            to: profile!.email,
            subject: `${shortName} Interac payment instructions`,
            text: `Your ${shortName} Interac payment request is pending.\n\nAmount: ${(amountMinor / 100).toFixed(2)} CAD\nSend to: ${methodSettings.interac_recipient_email}\nPayment reference: ${paymentId}\n\n${methodSettings.interac_instructions}\n\nYour membership or event registration will be finalized after the club confirms receipt.`,
            idempotencyKey: `interac-instructions:${paymentId}`,
          });
          if (emailResponse.ok) {
            const marked = await db
              .from('payments')
              .update({ manual_instructions_sent_at: new Date().toISOString() })
              .eq('id', paymentId)
              .is('manual_instructions_sent_at', null);
            if (marked?.error)
              console.error('[Payments] Could not record Interac instructions as sent', {
                paymentId,
                message: marked.error.message,
              });
          } else
            console.error('[Payments] Interac instructions email failed', {
              paymentId,
              status: emailResponse.status,
            });
        } catch (emailError) {
          console.error('[Payments] Interac instructions email failed', {
            paymentId,
            message: emailError instanceof Error ? emailError.message : 'unknown',
          });
        }
      }
      return NextResponse.json({
        provider: 'interac',
        paymentId,
        amountMinor,
        currency,
        recipientEmail: methodSettings.interac_recipient_email,
        instructions: methodSettings.interac_instructions,
        message:
          'Interac request submitted. Your membership or event registration will be finalized after an administrator confirms receipt.',
      });
    }

    const origin = getSiteOrigin(request);
    const defaultReturnTo = body.purpose === 'membership' ? '/member/membership' : '/events';
    const returnTo = safeRedirectPath(body.returnTo?.trim(), defaultReturnTo);
    const returnLabel =
      body.returnLabel?.trim().slice(0, 120) ||
      (body.purpose === 'membership' ? 'Back to membership' : 'Back to event');
    const stripe = getStripeClient();
    let payment: {
      id: string;
      user_id: string | null;
      purpose: string;
      business_record_id: string | null;
      amount_minor: number;
      currency: string;
      status: string;
      stripe_checkout_session_id?: string | null;
    };
    let existingPaymentQuery = db
      .from('payments')
      .select(
        'id,user_id,purpose,business_record_id,amount_minor,currency,status,stripe_checkout_session_id',
      )
      .eq('purpose', body.purpose)
      .eq('business_record_id', businessRecordId)
      .in('status', ['pending', 'processing', 'failed', 'succeeded']);
    if (user) existingPaymentQuery = existingPaymentQuery.eq('user_id', user!.id);
    else existingPaymentQuery = existingPaymentQuery.is('user_id', null);
    const { data: existingPayment, error: existingPaymentError } = await existingPaymentQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingPaymentError) throw new Error('Could not check for an existing payment attempt.');
    if (existingPayment) {
      payment = existingPayment;
      if (existingPayment.status === 'succeeded') {
        const { error: fulfillmentError } = await db.rpc('fulfill_successful_payment', {
          p_payment_id: existingPayment.id,
        });
        if (fulfillmentError)
          throw new Error(
            'The payment succeeded but its membership or registration is still being finalized.',
          );
        const returnUrl = existingPayment.stripe_checkout_session_id
          ? `${origin}/payments/return?session_id=${encodeURIComponent(existingPayment.stripe_checkout_session_id)}&return_to=${encodeURIComponent(returnTo)}&return_label=${encodeURIComponent(returnLabel)}`
          : `${origin}/payments/return?payment_id=${encodeURIComponent(existingPayment.id)}&return_to=${encodeURIComponent(returnTo)}&return_label=${encodeURIComponent(returnLabel)}`;
        return NextResponse.json({ checkoutUrl: returnUrl, paymentId: existingPayment.id });
      }
      if (existingPayment.amount_minor !== amountMinor || existingPayment.currency !== currency) {
        return NextResponse.json(
          {
            error:
              'An existing payment attempt has a different amount. Contact the club administrator.',
          },
          { status: 409 },
        );
      }
      if (existingPayment.stripe_checkout_session_id) {
        const existingSession = await stripe.checkout.sessions.retrieve(
          existingPayment.stripe_checkout_session_id,
        );
        if (
          existingSession.metadata?.pctc_payment_id !== existingPayment.id ||
          existingSession.metadata?.pctc_purpose !== body.purpose ||
          existingSession.metadata?.pctc_business_record_id !== businessRecordId ||
          (existingSession.metadata?.pctc_user_id ?? '') !== (user?.id ?? '') ||
          (existingSession.amount_total !== null && existingSession.amount_total !== amountMinor) ||
          (existingSession.currency && existingSession.currency.toLowerCase() !== currency)
        ) {
          throw new Error('Existing Stripe Checkout Session does not match this payment request.');
        }
        if (existingSession.status === 'open' && existingSession.url)
          return NextResponse.json({
            checkoutUrl: existingSession.url,
            paymentId: existingPayment.id,
          });
        if (existingSession.status === 'complete')
          return NextResponse.json({
            checkoutUrl: `${origin}/payments/return?session_id=${encodeURIComponent(existingSession.id)}&return_to=${encodeURIComponent(returnTo)}&return_label=${encodeURIComponent(returnLabel)}`,
            paymentId: existingPayment.id,
          });
        if (existingSession.status === 'expired') {
          const { data: canceledRow, error: cancelError } = await db
            .from('payments')
            .update(canceledPaymentPatch())
            .eq('id', existingPayment.id)
            .in('status', ['pending', 'processing', 'failed'])
            .select('id')
            .maybeSingle();
          if (cancelError) throw new Error('Could not close the expired payment attempt.');
          if (!canceledRow) {
            const { data: latestPayment, error: latestPaymentError } = await db
              .from('payments')
              .select('status,stripe_checkout_session_id')
              .eq('id', existingPayment.id)
              .maybeSingle();
            if (latestPaymentError)
              throw new Error('Could not verify the payment state after checkout expiration.');
            if (latestPayment?.status === 'succeeded') {
              const { error: fulfillmentError } = await db.rpc('fulfill_successful_payment', {
                p_payment_id: existingPayment.id,
              });
              if (fulfillmentError)
                throw new Error(
                  'The payment succeeded but its membership or registration is still being finalized.',
                );
              const returnUrl = latestPayment.stripe_checkout_session_id
                ? `${origin}/payments/return?session_id=${encodeURIComponent(latestPayment.stripe_checkout_session_id)}`
                : `${origin}/payments/return?payment_id=${encodeURIComponent(existingPayment.id)}&return_to=${encodeURIComponent(returnTo)}&return_label=${encodeURIComponent(returnLabel)}`;
              return NextResponse.json({ checkoutUrl: returnUrl, paymentId: existingPayment.id });
            }
            return NextResponse.json(
              { error: 'Payment status changed. Refresh the page and try again.' },
              { status: 409 },
            );
          }
          payment = await createPendingPayment({
            userId: user?.id ?? null,
            purpose: body.purpose,
            businessRecordId,
            amountMinor,
            currency,
            idempotencyKey,
          });
        }
      }
    } else {
      payment = await createPendingPayment({
        userId: user?.id ?? null,
        purpose: body.purpose,
        businessRecordId,
        amountMinor,
        currency,
        idempotencyKey,
      });
    }
    if (payment.status === 'succeeded')
      return NextResponse.json({ error: 'This payment has already succeeded.' }, { status: 409 });

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: customerEmail,
        client_reference_id: payment.id,
        line_items: [
          {
            quantity: 1,
            price_data: { currency, unit_amount: amountMinor, product_data: { name: description } },
          },
        ],
        metadata: {
          pctc_payment_id: payment.id,
          pctc_purpose: body.purpose,
          pctc_business_record_id: businessRecordId,
          pctc_user_id: user?.id ?? '',
        },
        payment_intent_data: {
          metadata: {
            pctc_payment_id: payment.id,
            pctc_purpose: body.purpose,
            pctc_business_record_id: businessRecordId,
            pctc_user_id: user?.id ?? '',
          },
        },
        success_url: `${origin}/payments/return?session_id={CHECKOUT_SESSION_ID}&return_to=${encodeURIComponent(returnTo)}&return_label=${encodeURIComponent(returnLabel)}`,
        cancel_url: `${origin}/payments/return?canceled=1&payment_id=${encodeURIComponent(payment.id)}&return_to=${encodeURIComponent(returnTo)}&return_label=${encodeURIComponent(returnLabel)}`,
      },
      { idempotencyKey: `pctc-checkout:${payment.id}` },
    );
    const { error: updateError } = await db
      .from('payments')
      .update({
        stripe_checkout_session_id: session.id,
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);
    if (updateError) {
      // Keep the session open: the Stripe idempotency key is tied to the payment ID,
      // so a retry can retrieve the same session and persist its reference.
      throw new Error('Could not save the Stripe Checkout Session reference. Please retry.');
    }
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
    return NextResponse.json({ checkoutUrl: session.url, paymentId: payment.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown checkout error';
    console.error('[Payments] Checkout creation failed', { message });
    return NextResponse.json(
      { error: 'Could not start checkout. Please try again or contact the club administrator.' },
      { status: 500 },
    );
  }
}
