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
    const body = (await request.json()) as {
      registrationId?: string;
      paymentId?: string;
      participantId?: string;
      participantIds?: string[];
      explicitCancel?: boolean;
    };
    const db = createPaymentServiceClient();

    if (body.participantIds) {
      if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
      const ids = [...new Set(body.participantIds)];
      if (ids.length !== 2)
        return NextResponse.json(
          { error: 'Both League team entries are required.' },
          { status: 400 },
        );
      const { data: entries, error: entriesError } = await db
        .from('tournament_participants')
        .select('id,event_id,user_id,status')
        .in('id', ids);
      if (entriesError || entries?.length !== 2)
        return NextResponse.json(
          { error: 'League team entries could not be verified.' },
          { status: 404 },
        );
      const [first, second] = entries;
      if (
        first.event_id !== second.event_id ||
        !first.user_id ||
        !second.user_id ||
        first.status !== 'registered' ||
        second.status !== 'registered'
      )
        return NextResponse.json(
          { error: 'League team entries could not be verified.' },
          { status: 409 },
        );
      const { data: pairs, error: pairError } = await db
        .from('tournament_pairs')
        .select('player_one_id,player_two_id,league_team_id,status')
        .eq('event_id', first.event_id)
        .eq('status', 'active');
      if (pairError) throw new Error('Could not verify the League team pair.');
      const pair = (pairs ?? []).find(
        (row) => ids.includes(row.player_one_id) && ids.includes(row.player_two_id),
      );
      if (!pair?.league_team_id)
        return NextResponse.json(
          { error: 'These entries are not a confirmed League team.' },
          { status: 409 },
        );
      const { data: leagueTeam, error: teamError } = await db
        .from('league_teams')
        .select('player_one_id,player_two_id,status')
        .eq('id', pair.league_team_id)
        .maybeSingle();
      if (teamError || leagueTeam?.status !== 'active')
        return NextResponse.json(
          { error: 'The confirmed League team could not be verified.' },
          { status: 409 },
        );
      const memberIds = [leagueTeam.player_one_id, leagueTeam.player_two_id];
      if (
        !memberIds.includes(user.id) ||
        !memberIds.includes(first.user_id) ||
        !memberIds.includes(second.user_id)
      )
        return NextResponse.json(
          { error: 'You cannot cancel this League team payment.' },
          { status: 403 },
        );

      const { data: candidates, error: candidateError } = await db
        .from('payments')
        .select('id,status,business_record_id,stripe_checkout_session_id')
        .in('user_id', memberIds)
        .eq('purpose', 'tournament_registration')
        .in('status', ['pending', 'processing', 'failed'])
        .order('created_at', { ascending: false })
        .limit(20);
      if (candidateError) throw new Error('Could not inspect pending League team payments.');
      const payments = (candidates ?? []).filter((candidate) =>
        ids.some((id) => (candidate.business_record_id || '').split(',').includes(id)),
      );
      for (const payment of payments) {
        if (!payment.stripe_checkout_session_id)
          return NextResponse.json(
            {
              error:
                'A pending team payment could not be safely canceled. Contact the organizer before withdrawing.',
            },
            { status: 409 },
          );
        const stripe = getStripeClient();
        const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
        if (session.status === 'complete')
          return NextResponse.json(
            {
              error: 'Team checkout has completed. Refresh and verify payment before withdrawing.',
            },
            { status: 409 },
          );
        if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        const verified = await stripe.checkout.sessions.retrieve(
          payment.stripe_checkout_session_id,
        );
        if (verified.status !== 'expired')
          return NextResponse.json(
            { error: 'Team payment status is uncertain; the team was not withdrawn.' },
            { status: 409 },
          );
        const { error: updateError } = await db
          .from('payments')
          .update({
            status: 'canceled',
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id)
          .in('status', ['pending', 'processing', 'failed']);
        if (updateError) throw new Error('Could not close a pending League team checkout.');
      }
      return NextResponse.json({ success: true, noPendingPayment: payments.length === 0 });
    }

    if (body.participantId) {
      if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
      const { data: candidates, error: candidateError } = await db
        .from('payments')
        .select('id,status,business_record_id,stripe_checkout_session_id')
        .eq('user_id', user.id)
        .eq('purpose', 'tournament_registration')
        .in('status', ['pending', 'processing', 'failed'])
        .order('created_at', { ascending: false })
        .limit(10);
      if (candidateError) throw new Error('Could not inspect pending tournament payments.');
      const payment = (candidates ?? []).find((candidate) =>
        (candidate.business_record_id || '').split(',').includes(body.participantId!),
      );
      if (!payment) return NextResponse.json({ success: true, noPendingPayment: true });
      if (!payment.stripe_checkout_session_id)
        return NextResponse.json(
          {
            error:
              'A pending payment could not be safely canceled. Contact the organizer before withdrawing.',
          },
          { status: 409 },
        );
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
      if (session.status === 'complete')
        return NextResponse.json(
          {
            error: 'Payment checkout has completed. Refresh and verify payment before withdrawing.',
          },
          { status: 409 },
        );
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
      const verified = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
      if (verified.status !== 'expired')
        return NextResponse.json(
          { error: 'Payment status is uncertain; the entry was not withdrawn.' },
          { status: 409 },
        );
      const { error: updateError } = await db
        .from('payments')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .in('status', ['pending', 'processing', 'failed']);
      if (updateError) throw new Error('Could not close the pending tournament checkout.');
      return NextResponse.json({ success: true });
    }

    if (body.paymentId) {
      let query = db
        .from('payments')
        .select('id,user_id,purpose,business_record_id,status,stripe_checkout_session_id')
        .eq('id', body.paymentId);
      if (user) query = query.eq('user_id', user.id);
      else query = query.is('user_id', null).eq('purpose', 'tournament_registration');
      const { data: payment, error } = await query.maybeSingle();
      if (error) throw new Error('Could not look up the payment.');
      if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
      if (payment.status === 'succeeded')
        return NextResponse.json({ error: 'Payment is already confirmed.' }, { status: 409 });
      if (payment.purpose !== 'tournament_registration' || !payment.business_record_id)
        return NextResponse.json({ success: true, provisionalRegistrationRemoved: false });
      const ids = payment.business_record_id.split(',').filter(Boolean);
      const { data: entries, error: entriesError } = await db
        .from('tournament_participants')
        .select('id,user_id,status')
        .in('id', ids);
      if (entriesError || (entries?.length !== ids.length && payment.status !== 'canceled'))
        throw new Error('Could not verify tournament entries.');
      const provisionalGuestIds = (entries ?? [])
        .filter((entry) => entry.user_id === null && entry.status === 'provisional')
        .map((entry) => entry.id);
      const guestOnly = provisionalGuestIds.length > 0;
      // Guest payment IDs are bearer references; a guest may cancel only this pending tournament payment.
      // If it contains no provisional guest entries, cancellation leaves registered partner entries intact.
      if (payment.stripe_checkout_session_id) {
        const stripe = getStripeClient();
        const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
        if (session.status === 'complete')
          return NextResponse.json(
            {
              error: 'Checkout has completed; verifying payment before changing the registration.',
            },
            { status: 409 },
          );
        if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        const verified = await stripe.checkout.sessions.retrieve(
          payment.stripe_checkout_session_id,
        );
        if (verified.status !== 'expired')
          return NextResponse.json(
            {
              error:
                'Checkout state is uncertain; the registration was kept. Refresh and check payment status.',
            },
            { status: 409 },
          );
      } else {
        return NextResponse.json(
          { error: 'Payment status is uncertain; the registration was kept.' },
          { status: 409 },
        );
      }
      const { error: updateError } = await db
        .from('payments')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .in('status', ['pending', 'processing', 'failed']);
      if (updateError) throw new Error('Could not cancel the pending payment.');
      if (guestOnly) {
        const [{ data: pairsOne, error: pairsOneError }, { data: pairsTwo, error: pairsTwoError }] =
          await Promise.all([
            db
              .from('tournament_pairs')
              .select('player_one_id,player_two_id')
              .in('player_one_id', provisionalGuestIds),
            db
              .from('tournament_pairs')
              .select('player_one_id,player_two_id')
              .in('player_two_id', provisionalGuestIds),
          ]);
        if (pairsOneError || pairsTwoError)
          throw new Error('Could not inspect the provisional partner registration.');
        const relatedIds = [
          ...new Set([
            ...provisionalGuestIds,
            ...(pairsOne ?? []).flatMap((pair) => [pair.player_one_id, pair.player_two_id]),
            ...(pairsTwo ?? []).flatMap((pair) => [pair.player_one_id, pair.player_two_id]),
          ]),
        ];
        const { data: relatedEntries, error: relatedError } = await db
          .from('tournament_participants')
          .select('id,user_id,status')
          .in('id', relatedIds);
        if (relatedError) throw new Error('Could not inspect provisional tournament entries.');
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
        if (deletePairsOneError || deletePairsTwoError)
          throw new Error('Could not remove the provisional tournament pair.');
        const { error: deleteError } = await db
          .from('tournament_participants')
          .delete()
          .in('id', cleanupIds)
          .eq('status', 'provisional');
        if (deleteError)
          throw new Error(
            'Payment was canceled but provisional registration cleanup needs administrator review.',
          );
      }
      return NextResponse.json({
        success: true,
        provisionalRegistrationRemoved: guestOnly || (!user && payment.status === 'canceled'),
      });
    }

    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    if (!body.registrationId)
      return NextResponse.json({ error: 'Registration ID is required.' }, { status: 400 });
    const { data: payment, error } = await db
      .from('payments')
      .select('id,status,stripe_checkout_session_id')
      .eq('user_id', user.id)
      .eq('purpose', 'event_registration')
      .eq('business_record_id', body.registrationId)
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error('Could not look up the pending payment.');
    if (!payment) return NextResponse.json({ success: true, noPendingPayment: true });
    if (payment.stripe_checkout_session_id) {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
      if (session.status === 'complete')
        return NextResponse.json(
          {
            error:
              'Checkout has already completed. Refresh the event page to confirm payment before withdrawing.',
          },
          { status: 409 },
        );
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
    }
    const { error: updateError } = await db
      .from('payments')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id)
      .in('status', ['pending', 'processing', 'failed']);
    if (updateError) throw new Error('Could not cancel the pending payment.');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Payments] Cancel checkout failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json(
      {
        error:
          'Could not safely cancel the pending checkout. Please refresh and check payment status.',
      },
      { status: 500 },
    );
  }
}
