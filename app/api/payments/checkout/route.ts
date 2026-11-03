import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { sendResendEmail } from '@/lib/resend';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { getSiteOrigin } from '@/lib/site-url';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getSignedInUser } from '@/lib/api-helpers';
import { canceledPaymentPatch } from '@/lib/payments/checkout-cleanup';
import { createPendingPayment } from '@/lib/payments/server';
import { getStripeClient } from '@/lib/payments/stripe';
import { getMembershipSeason, type MembershipSeasonSettings } from '@/lib/membership-season';

export const runtime = 'nodejs';

type CheckoutBody = {
  purpose?: 'membership' | 'event_registration' | 'tournament_registration';
  provider?: 'stripe' | 'interac';
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
  return createServiceRoleClient(url, key);
}

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

    const db = getServiceClient();
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

    let businessRecordId = body.businessRecordId?.trim() || '';
    let amountMinor = 0;
    const currency = 'cad';
    let description = '';
    const customerEmail = profile?.email || user?.email || undefined;

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
      const season = getMembershipSeason(settings as MembershipSeasonSettings)!;
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
          .eq('user_id', user!.id)
          .eq('status', 'confirmed')
          .maybeSingle();
        if (!originalFamily || !familyLink)
          return NextResponse.json(
            { error: 'You are not authorized to pay for this family membership.' },
            { status: 403 },
          );
        const { data: confirmedFamilyMembers, error: confirmedMembersError } = await db
          .from('membership_family_members')
          .select('user_id,invited_by,waiver_version,waiver_accepted_at')
          .eq('family_id', originalFamily.id)
          .eq('status', 'confirmed');
        if (confirmedMembersError)
          throw new Error('Could not verify the confirmed family members.');
        if (!confirmedFamilyMembers || confirmedFamilyMembers.length < 2)
          return NextResponse.json(
            {
              error:
                'At least two family members must accept the invitation before family membership can be paid.',
            },
            { status: 409 },
          );
        if (
          originalFamily.season_year === season.year &&
          (originalFamily.paid_at || originalFamily.payment_id)
        ) {
          return NextResponse.json(
            { error: 'This family membership is already marked as paid for the current season.' },
            { status: 409 },
          );
        }
        if (originalFamily.season_year !== season.year) {
          const { data: renewedFamily, error: renewedFamilyError } = await db
            .from('membership_families')
            .insert({ season_year: season.year })
            .select('id')
            .single();
          if (renewedFamilyError || !renewedFamily)
            throw new Error('Could not create the family membership for the new season.');
          const { error: copyMembersError } = await db.from('membership_family_members').insert(
            confirmedFamilyMembers.map((member) => ({
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
        const { data: members, error: membersError } = await db
          .from('membership_family_members')
          .select(
            'user_id,waiver_version,waiver_accepted_at,profiles:profiles!membership_family_members_user_id_fkey(application_status)',
          )
          .eq('family_id', businessRecordId)
          .eq('status', 'confirmed');
        if (membersError || !members?.length)
          return NextResponse.json(
            { error: 'Every confirmed family member must have an approved profile.' },
            { status: 409 },
          );
        if (members.length < 2)
          return NextResponse.json(
            {
              error:
                'At least two family members must accept the invitation before family membership can be paid.',
            },
            { status: 409 },
          );
        if (
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
        description = `PCTC family membership — season ${season.year}`;
      } else {
        const targetSeason = season;
        let membership: {
          id: string;
          payment_status: string;
          starts_on: string | null;
          ends_on: string | null;
          waiver_version: string | null;
          waiver_accepted_at: string | null;
        } | null = null;
        if (businessRecordId) {
          const { data: existing, error: existingError } = await db
            .from('memberships')
            .select('id,user_id,payment_status,starts_on,ends_on,waiver_version,waiver_accepted_at')
            .eq('id', businessRecordId)
            .eq('user_id', user!.id)
            .maybeSingle();
          if (existingError) throw new Error('Could not verify the membership record.');
          if (!existing)
            return NextResponse.json({ error: 'Membership record not found.' }, { status: 404 });
          membership = existing;
        } else {
          const { data: currentMembership, error: membershipReadError } = await db
            .from('memberships')
            .select('id,payment_status,starts_on,ends_on,waiver_version,waiver_accepted_at')
            .eq('user_id', user!.id)
            .eq('starts_on', targetSeason.startsOn)
            .eq('ends_on', targetSeason.endsOn)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (membershipReadError) throw new Error('Could not check for a current membership.');
          membership = currentMembership;
        }
        if (!membership)
          return NextResponse.json(
            { error: 'Accept the current membership waiver before paying.' },
            { status: 409 },
          );
        if (
          membership.starts_on !== targetSeason.startsOn ||
          membership.ends_on !== targetSeason.endsOn
        )
          return NextResponse.json(
            {
              error:
                'This membership record belongs to another season. Refresh the page and start checkout for the current season.',
            },
            { status: 409 },
          );
        if (membership.payment_status === 'paid')
          return NextResponse.json({ error: 'This membership is already paid.' }, { status: 409 });
        if (membership.waiver_version !== String(waiver.version) || !membership.waiver_accepted_at)
          return NextResponse.json(
            { error: 'Accept the current membership waiver before paying.' },
            { status: 409 },
          );
        businessRecordId = membership.id;
        amountMinor = Number(settings.single_price_cents);
        description = 'PCTC individual membership';
      }
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
        return NextResponse.json(
          { error: 'Membership price must be configured to a positive amount.' },
          { status: 503 },
        );
    } else if (body.purpose === 'event_registration') {
      if (!businessRecordId)
        return NextResponse.json({ error: 'An event registration is required.' }, { status: 400 });
      const { data: registration } = await db
        .from('registrations')
        .select(
          'id,event_id,user_id,status,payment_status,amount_cents,created_at,event:events(id,title,price_cents,status,starts_at,registration_opens_at,registration_closes_at,members_only)',
        )
        .eq('id', businessRecordId)
        .eq('user_id', user!.id)
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
    } else {
      const participantIds = [
        ...new Set(
          businessRecordId
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      if (
        !participantIds.length ||
        participantIds.length > 2 ||
        participantIds.some(
          (id) =>
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
        )
      ) {
        return NextResponse.json(
          { error: 'Select one or two valid tournament entries to pay.' },
          { status: 400 },
        );
      }
      participantIds.sort();
      businessRecordId = participantIds.join(',');
      const { data: entries, error: entriesError } = await db
        .from('tournament_participants')
        .select(
          'id,event_id,user_id,amount_cents,payment_status,status,display_name,confirmation_status',
        )
        .in('id', participantIds);
      if (entriesError) throw new Error('Could not verify tournament entries.');
      if (
        !entries ||
        entries.length !== participantIds.length ||
        entries.some((entry) => entry.event_id !== entries[0].event_id) ||
        entries.some(
          (entry) => entry.status !== 'registered' || entry.confirmation_status !== 'confirmed',
        )
      ) {
        return NextResponse.json(
          {
            error:
              'One or more tournament entries are not eligible for payment. Check their payment status and try again.',
          },
          { status: 409 },
        );
      }
      if (!entries.some((entry) => entry.user_id === user!.id)) {
        return NextResponse.json(
          { error: 'The payer must be a registered participant in the selected entries.' },
          { status: 403 },
        );
      }
      const { data: eventPairs, error: eventPairsError } = await db
        .from('tournament_pairs')
        .select('player_one_id,player_two_id')
        .eq('event_id', entries[0].event_id)
        .eq('status', 'active');
      if (eventPairsError) throw new Error('Could not verify tournament partner confirmations.');
      const selectedIds = new Set(participantIds);
      const partnerIds = [
        ...new Set(
          (eventPairs ?? []).flatMap((pair) => {
            const selectedOne = selectedIds.has(pair.player_one_id);
            const selectedTwo = selectedIds.has(pair.player_two_id);
            return selectedOne && !selectedTwo
              ? [pair.player_two_id]
              : selectedTwo && !selectedOne
                ? [pair.player_one_id]
                : [];
          }),
        ),
      ];
      if (partnerIds.length) {
        const { data: partners, error: partnersError } = await db
          .from('tournament_participants')
          .select('id,status,confirmation_status')
          .in('id', partnerIds);
        if (
          partnersError ||
          partners?.length !== partnerIds.length ||
          partners.some(
            (partner) =>
              partner.status !== 'registered' || partner.confirmation_status !== 'confirmed',
          )
        )
          return NextResponse.json(
            { error: 'Your partner must confirm before this team can pay.' },
            { status: 409 },
          );
      }
      const unpaidEntries = entries.filter((entry) =>
        ['pending', 'failed'].includes(entry.payment_status),
      );
      if (!unpaidEntries.length)
        return NextResponse.json(
          { error: 'The selected tournament entries are already paid.' },
          { status: 409 },
        );
      businessRecordId = unpaidEntries
        .map((entry) => entry.id)
        .sort()
        .join(',');
      const eventId = entries[0].event_id;
      if (entries.some((entry) => entry.event_id !== eventId))
        return NextResponse.json(
          { error: 'Entries must belong to the same tournament.' },
          { status: 400 },
        );
      const { data: tournamentEvent } = await db
        .from('events')
        .select('id,title,event_type,status,starts_at,price_cents')
        .eq('id', eventId)
        .maybeSingle();
      if (
        !tournamentEvent ||
        tournamentEvent.event_type !== 'tournament' ||
        tournamentEvent.status !== 'published' ||
        new Date(tournamentEvent.starts_at).getTime() <= Date.now()
      ) {
        return NextResponse.json(
          { error: 'This tournament is not accepting payment.' },
          { status: 409 },
        );
      }
      amountMinor = unpaidEntries.reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
        return NextResponse.json(
          { error: 'The selected tournament entries do not require payment.' },
          { status: 409 },
        );
      description = `PCTC tournament entries — ${tournamentEvent.title} (${unpaidEntries.length} participant${unpaidEntries.length === 1 ? '' : 's'})`;
    }

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
          const from =
            process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM!;
          const emailResponse = await sendResendEmail({
            from,
            to: profile!.email,
            subject: 'PCTC Interac payment instructions',
            text: `Your PCTC Interac payment request is pending.\n\nAmount: ${(amountMinor / 100).toFixed(2)} CAD\nSend to: ${methodSettings.interac_recipient_email}\nPayment reference: ${paymentId}\n\n${methodSettings.interac_instructions}\n\nYour membership or event registration will be finalized after the club confirms receipt.`,
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
