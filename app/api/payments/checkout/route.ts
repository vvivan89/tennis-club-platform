import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createPendingPayment } from '@/lib/payments/server';
import { getStripeClient } from '@/lib/payments/stripe';

export const runtime = 'nodejs';

type CheckoutBody = {
  purpose?: 'membership' | 'event_registration';
  businessRecordId?: string;
  membershipKind?: 'individual' | 'family';
  waiverAccepted?: boolean;
  waiverVersion?: number;
  idempotencyKey?: string;
  returnTo?: string;
  returnLabel?: string;
};

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Payment storage is not configured on the server.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function seasonDates(settings: {
  season_start_month: number;
  season_start_day: number;
  season_end_month: number;
  season_end_day: number;
}) {
  const now = new Date();
  const startThisYear = new Date(
    now.getFullYear(),
    settings.season_start_month - 1,
    settings.season_start_day,
  );
  const endThisYear = new Date(
    now.getFullYear(),
    settings.season_end_month - 1,
    settings.season_end_day,
    23,
    59,
    59,
    999,
  );
  const year =
    now < startThisYear
      ? now.getFullYear()
      : now > endThisYear
        ? now.getFullYear() + 1
        : now.getFullYear();
  const start = new Date(year, settings.season_start_month - 1, settings.season_start_day);
  const end = new Date(year, settings.season_end_month - 1, settings.season_end_day);
  return {
    startsOn: start.toISOString().slice(0, 10),
    endsOn: end.toISOString().slice(0, 10),
    seasonYear: year,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await createSupabaseServerClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

    const body = (await request.json()) as CheckoutBody;
    if (!body.purpose || !['membership', 'event_registration'].includes(body.purpose)) {
      return NextResponse.json({ error: 'Unsupported payment purpose.' }, { status: 400 });
    }
    const idempotencyKey = body.idempotencyKey?.trim() || randomUUID();
    if (idempotencyKey.length > 200)
      return NextResponse.json({ error: 'Invalid payment request key.' }, { status: 400 });

    const db = getServiceClient();
    const [{ data: profile }, { data: settings, error: settingsError }] = await Promise.all([
      db
        .from('profiles')
        .select('id,email,full_name,application_status')
        .eq('id', user.id)
        .maybeSingle(),
      db.from('membership_plan_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (!profile || profile.application_status !== 'approved') {
      return NextResponse.json(
        { error: 'An approved member profile is required to make a payment.' },
        { status: 403 },
      );
    }
    if (settingsError) throw new Error('Could not load membership pricing settings.');

    let businessRecordId = body.businessRecordId?.trim() || '';
    let amountMinor = 0;
    const currency = 'cad';
    let description = '';
    const customerEmail = profile.email || user.email || undefined;

    if (body.purpose === 'membership') {
      if (!settings)
        return NextResponse.json(
          { error: 'Membership pricing is not configured.' },
          { status: 503 },
        );
      if (body.waiverAccepted !== true)
        return NextResponse.json(
          { error: 'You must accept the current membership waiver before paying.' },
          { status: 400 },
        );
      const { data: waiver, error: waiverError } = await db
        .from('legal_document_versions')
        .select('version')
        .eq('document_type', 'membership_waiver')
        .eq('is_current', true)
        .maybeSingle();
      if (waiverError || !waiver)
        return NextResponse.json(
          { error: 'The current membership waiver is unavailable.' },
          { status: 503 },
        );
      if (body.waiverVersion !== undefined && body.waiverVersion !== waiver.version)
        return NextResponse.json(
          {
            error:
              'The membership waiver changed. Refresh the page and review the current version.',
          },
          { status: 409 },
        );

      if (body.membershipKind === 'family') {
        if (!businessRecordId)
          return NextResponse.json({ error: 'A family membership is required.' }, { status: 400 });
        const { data: originalFamily } = await db
          .from('membership_families')
          .select('id,season_year,paid_at,payment_id')
          .eq('id', businessRecordId)
          .maybeSingle();
        const { data: familyLink } = await db
          .from('membership_family_members')
          .select('id,status')
          .eq('family_id', businessRecordId)
          .eq('user_id', user.id)
          .eq('status', 'confirmed')
          .maybeSingle();
        if (!originalFamily || !familyLink)
          return NextResponse.json(
            { error: 'You are not authorized to pay for this family membership.' },
            { status: 403 },
          );
        const season = seasonDates(settings);
        if (
          originalFamily.season_year === season.seasonYear &&
          (originalFamily.paid_at || originalFamily.payment_id)
        ) {
          return NextResponse.json(
            { error: 'This family membership is already marked as paid for the current season.' },
            { status: 409 },
          );
        }
        if (originalFamily.season_year !== season.seasonYear) {
          const { data: priorMembers, error: priorMembersError } = await db
            .from('membership_family_members')
            .select('user_id,invited_by,waiver_version,waiver_accepted_at')
            .eq('family_id', originalFamily.id)
            .eq('status', 'confirmed');
          if (priorMembersError || !priorMembers?.length)
            throw new Error('Could not load the existing family members for renewal.');
          const { data: renewedFamily, error: renewedFamilyError } = await db
            .from('membership_families')
            .insert({ season_year: season.seasonYear })
            .select('id')
            .single();
          if (renewedFamilyError || !renewedFamily)
            throw new Error('Could not create the family membership for the new season.');
          const { error: copyMembersError } = await db.from('membership_family_members').insert(
            priorMembers.map((member) => ({
              family_id: renewedFamily.id,
              user_id: member.user_id,
              invited_by: member.invited_by,
              status: 'confirmed',
              joined_at: new Date().toISOString(),
              waiver_version: member.waiver_version,
              waiver_accepted_at: member.waiver_accepted_at,
            })),
          );
          if (copyMembersError) {
            await db.from('membership_families').delete().eq('id', renewedFamily.id);
            throw new Error('Could not copy confirmed family members to the new season.');
          }
          businessRecordId = renewedFamily.id;
        }
        const { error: ownWaiverError } = await db
          .from('membership_family_members')
          .update({
            waiver_version: String(waiver.version),
            waiver_accepted_at: new Date().toISOString(),
          })
          .eq('family_id', businessRecordId)
          .eq('user_id', user.id)
          .eq('status', 'confirmed');
        if (ownWaiverError) throw new Error('Could not save family waiver acceptance.');
        const { data: members, error: membersError } = await db
          .from('membership_family_members')
          .select(
            'user_id,waiver_version,waiver_accepted_at,profiles:profiles!membership_family_members_user_id_fkey(application_status)',
          )
          .eq('family_id', businessRecordId)
          .eq('status', 'confirmed');
        if (
          membersError ||
          !members?.length ||
          members.some((m) => {
            const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
            return p?.application_status !== 'approved';
          })
        )
          return NextResponse.json(
            { error: 'Every confirmed family member must have an approved profile.' },
            { status: 409 },
          );
        if (
          members.some((m) => m.waiver_version !== String(waiver.version) || !m.waiver_accepted_at)
        ) {
          return NextResponse.json(
            {
              error:
                'Every confirmed family member must review and accept the current waiver before the family membership can be paid.',
            },
            { status: 409 },
          );
        }
        businessRecordId = `family:${businessRecordId}`;
        amountMinor = Number(settings.family_price_cents);
        description = `PCTC family membership — season ${season.seasonYear}`;
      } else {
        if (businessRecordId) {
          const { data: existing } = await db
            .from('memberships')
            .select(
              'id,user_id,status,payment_status,membership_type,starts_on,ends_on,waiver_version,waiver_accepted_at',
            )
            .eq('id', businessRecordId)
            .eq('user_id', user.id)
            .maybeSingle();
          if (!existing)
            return NextResponse.json({ error: 'Membership record not found.' }, { status: 404 });
          const targetSeason = seasonDates(settings);
          if (
            existing.starts_on !== targetSeason.startsOn ||
            existing.ends_on !== targetSeason.endsOn
          ) {
            return NextResponse.json(
              {
                error:
                  'This membership record belongs to another season. Refresh the page and start checkout for the current season.',
              },
              { status: 409 },
            );
          }
          if (existing.payment_status === 'paid')
            return NextResponse.json(
              { error: 'This membership is already paid.' },
              { status: 409 },
            );
          businessRecordId = existing.id;
          const { error: waiverUpdateError } = await db
            .from('memberships')
            .update({
              waiver_version: String(waiver.version),
              waiver_accepted_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
            .eq('user_id', user.id);
          if (waiverUpdateError) throw new Error('Could not save membership waiver acceptance.');
        } else {
          const { data: pendingMembership, error: pendingMembershipError } = await db
            .from('memberships')
            .select('id')
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .eq('payment_status', 'unpaid')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (pendingMembershipError)
            throw new Error('Could not check for an existing membership application.');
          if (pendingMembership) {
            const { error: waiverUpdateError } = await db
              .from('memberships')
              .update({
                waiver_version: String(waiver.version),
                waiver_accepted_at: new Date().toISOString(),
              })
              .eq('id', pendingMembership.id)
              .eq('user_id', user.id);
            if (waiverUpdateError) throw new Error('Could not save membership waiver acceptance.');
            businessRecordId = pendingMembership.id;
          } else {
            const season = seasonDates(settings);
            const { data: membership, error: membershipError } = await db
              .from('memberships')
              .insert({
                user_id: user.id,
                membership_type: 'individual',
                status: 'pending',
                payment_status: 'unpaid',
                starts_on: season.startsOn,
                ends_on: season.endsOn,
                waiver_version: String(waiver.version),
                waiver_accepted_at: new Date().toISOString(),
              })
              .select('id')
              .single();
            if (membershipError || !membership)
              throw new Error('Could not create the membership record.');
            businessRecordId = membership.id;
          }
        }
        amountMinor = Number(settings.single_price_cents);
        description = 'PCTC individual membership';
      }
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
        return NextResponse.json(
          { error: 'Membership price must be configured to a positive amount.' },
          { status: 503 },
        );
    } else {
      if (!businessRecordId)
        return NextResponse.json({ error: 'An event registration is required.' }, { status: 400 });
      const { data: registration } = await db
        .from('registrations')
        .select(
          'id,event_id,user_id,status,payment_status,amount_cents,created_at,event:events(id,title,price_cents,status,starts_at,registration_opens_at,registration_closes_at,members_only)',
        )
        .eq('id', businessRecordId)
        .eq('user_id', user.id)
        .maybeSingle();
      const event = Array.isArray(registration?.event)
        ? registration.event[0]
        : registration?.event;
      if (!registration || !event)
        return NextResponse.json({ error: 'Event registration not found.' }, { status: 404 });
      if (registration.status !== 'confirmed')
        return NextResponse.json(
          {
            error:
              'Only confirmed event registrations can be paid. Waitlisted registrations are not charged.',
          },
          { status: 409 },
        );
      if (registration.payment_status === 'paid' || registration.payment_status === 'not_required')
        return NextResponse.json(
          { error: 'This registration does not require payment.' },
          { status: 409 },
        );
      if (registration.payment_status === 'refunded')
        return NextResponse.json(
          {
            error:
              'This registration has been refunded. Contact the club before attempting another payment.',
          },
          { status: 409 },
        );
      const now = Date.now();
      const registeredAt = new Date(registration.created_at).getTime();
      if (
        event.status !== 'published' ||
        new Date(event.starts_at).getTime() <= now ||
        registeredAt < new Date(event.registration_opens_at).getTime() ||
        (event.registration_closes_at &&
          registeredAt >= new Date(event.registration_closes_at).getTime())
      ) {
        return NextResponse.json(
          {
            error:
              'This registration was not created during the event registration window, or the event has already started.',
          },
          { status: 409 },
        );
      }
      amountMinor = Number(event.price_cents);
      if (amountMinor <= 0 || registration.amount_cents !== amountMinor)
        return NextResponse.json(
          { error: 'Event price does not match the registration. Refresh and try again.' },
          { status: 409 },
        );
      description = `PCTC event registration — ${event.title}`;
    }

    const origin = new URL(request.url).origin;
    const requestedReturnTo =
      body.returnTo?.trim() || (body.purpose === 'membership' ? '/member/membership' : '/events');
    // Only accept same-origin relative paths; never allow an external redirect.
    const returnTo =
      requestedReturnTo.startsWith('/') &&
      !requestedReturnTo.startsWith('//') &&
      !requestedReturnTo.includes('\\')
        ? requestedReturnTo
        : body.purpose === 'membership'
          ? '/member/membership'
          : '/events';
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
    const { data: existingPayment, error: existingPaymentError } = await db
      .from('payments')
      .select(
        'id,user_id,purpose,business_record_id,amount_minor,currency,status,stripe_checkout_session_id',
      )
      .eq('user_id', user.id)
      .eq('purpose', body.purpose)
      .eq('business_record_id', businessRecordId)
      .in('status', ['pending', 'processing', 'failed', 'succeeded'])
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
          existingSession.metadata?.pctc_user_id !== user.id ||
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
            .update({
              status: 'canceled',
              canceled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
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
            userId: user.id,
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
        userId: user.id,
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
          pctc_user_id: user.id,
        },
        payment_intent_data: {
          metadata: {
            pctc_payment_id: payment.id,
            pctc_purpose: body.purpose,
            pctc_business_record_id: businessRecordId,
            pctc_user_id: user.id,
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
