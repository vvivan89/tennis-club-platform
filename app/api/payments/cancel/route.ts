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
    const body = (await request.json()) as { registrationId?: string };
    if (!body.registrationId)
      return NextResponse.json({ error: 'Registration ID is required.' }, { status: 400 });
    const db = createPaymentServiceClient();
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
      { error: 'Could not cancel the pending checkout. Please refresh and try again.' },
      { status: 500 },
    );
  }
}
