import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createPaymentServiceClient } from '@/lib/payments/server';
import { AdminNav } from '@/components/admin-nav';
import { FloatingFeedback } from '@/components/floating-feedback';
import { AdminPaymentsWorkspace } from '@/components/admin-payments-workspace';
import { syncPaymentProceeds } from '@/lib/payments/proceeds';
import { loadPaymentEventTitles } from '@/lib/payments/event-titles';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) redirect('/login?next=/admin/payments');
  const { data: profile } = await auth
    .from('profiles')
    .select('role,application_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin' || profile.application_status !== 'approved')
    redirect('/member/dashboard');

  const db = createPaymentServiceClient();
  type AdminPaymentRecord = {
    id: string;
    user_id: string;
    purpose: string;
    business_record_id: string | null;
    amount_minor: number;
    currency: string;
    status: string;
    provider: string | null;
    manual_review_status: string | null;
    refunded_amount_minor: number;
    created_at: string;
    succeeded_at: string | null;
    stripe_payment_intent_id: string | null;
    stripe_fee_minor: number | null;
    proceeds_minor: number | null;
  };
  const payments: AdminPaymentRecord[] = [];
  let error: { message: string } | null = null;
  for (let offset = 0; ; offset += 1000) {
    const result = await db
      .from('payments')
      .select(
        'id,user_id,purpose,business_record_id,amount_minor,currency,status,provider,manual_review_status,refunded_amount_minor,created_at,succeeded_at,stripe_payment_intent_id,stripe_fee_minor,proceeds_minor',
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + 999);
    if (result.error) {
      error = result.error;
      break;
    }
    const batch = (result.data ?? []) as AdminPaymentRecord[];
    payments.push(...batch);
    if (batch.length < 1000) break;
  }

  const { data: interacSettings } = await db
    .from('payment_method_settings')
    .select('interac_enabled,interac_recipient_email,interac_instructions')
    .eq('id', 1)
    .maybeSingle();

  let rows: Array<{
    provider: string;
    manualReviewStatus: string | null;
    id: string;
    purpose: string;
    eventName: string | null;
    amountMinor: number;
    currency: string;
    status: string;
    refundedAmountMinor: number;
    feeMinor: number | null;
    proceedsMinor: number | null;
    createdAt: string;
    succeededAt: string | null;
    userName: string | null;
    userEmail: string | null;
    refundable: boolean;
  }> = [];

  if (!error && payments?.length) {
    const userIds = [...new Set(payments.map((payment) => payment.user_id).filter(Boolean))];
    const [eventTitleByPaymentId, { data: profiles }] = await Promise.all([
      loadPaymentEventTitles(db, payments),
      userIds.length
        ? db
            .from('profiles')
            .select('id,full_name,email')
            .in('id', userIds)
            .eq('application_status', 'approved')
            .eq('account_kind', 'member')
        : Promise.resolve({ data: [] }),
    ]);
    const profileRows = (profiles ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>;
    const profileById = new Map(profileRows.map((item) => [item.id, item]));
    const paymentsWithoutMemberProfile = payments.filter(
      (payment) =>
        payment.purpose === 'tournament_registration' &&
        (!payment.user_id || !profileById.has(payment.user_id)) &&
        payment.business_record_id,
    );
    const guestParticipantIds = [
      ...new Set(
        paymentsWithoutMemberProfile.flatMap((payment) =>
          (payment.business_record_id ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ),
    ];
    const { data: guestParticipants, error: guestParticipantsError } = guestParticipantIds.length
      ? await db
          .from('tournament_participants')
          .select('id,display_name,email')
          .in('id', guestParticipantIds)
      : { data: [], error: null };
    if (guestParticipantsError) {
      console.error('[Payments] Could not load tournament guest payment details', {
        message: guestParticipantsError.message,
      });
    }
    const guestParticipantById = new Map(
      (
        (guestParticipants ?? []) as Array<{
          id: string;
          display_name: string;
          email: string | null;
        }>
      ).map((participant) => [participant.id, participant]),
    );

    await Promise.all(
      payments
        .filter(
          (payment) =>
            payment.provider === 'stripe' &&
            ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status) &&
            payment.stripe_payment_intent_id &&
            payment.proceeds_minor == null,
        )
        .slice(0, 20)
        .map(async (payment) => {
          try {
            const proceeds = await syncPaymentProceeds(
              db,
              payment.id,
              payment.stripe_payment_intent_id!,
            );
            if (proceeds) {
              (
                payment as typeof payment & {
                  proceeds_minor: number | null;
                  stripe_fee_minor: number | null;
                }
              ).proceeds_minor = proceeds.proceedsMinor;
              (payment as typeof payment & { stripe_fee_minor: number | null }).stripe_fee_minor =
                proceeds.feeMinor;
            }
          } catch (error) {
            console.error('[Payments] Could not retrieve proceeds for historical payment', {
              paymentId: payment.id,
              message: error instanceof Error ? error.message : 'unknown',
            });
          }
        }),
    );
    rows = payments.map((payment) => {
      const person = profileById.get(payment.user_id);
      const guestParticipantsForPayment = (payment.business_record_id ?? '')
        .split(',')
        .map((id) => guestParticipantById.get(id.trim()))
        .filter((participant) => participant !== undefined);
      const guestName = guestParticipantsForPayment
        .map((participant) => participant.display_name.trim())
        .filter(Boolean)
        .join(' + ');
      const guestEmail = guestParticipantsForPayment
        .map((participant) => participant.email?.trim())
        .filter((email): email is string => Boolean(email))
        .join(', ');
      const remaining = payment.amount_minor - payment.refunded_amount_minor;
      return {
        id: payment.id,
        provider: payment.provider ?? 'stripe',
        manualReviewStatus: payment.manual_review_status ?? null,
        purpose: payment.purpose,
        eventName: eventTitleByPaymentId.get(payment.id) ?? null,
        amountMinor: payment.amount_minor,
        currency: payment.currency,
        status: payment.status,
        refundedAmountMinor: payment.refunded_amount_minor,
        feeMinor: payment.stripe_fee_minor,
        proceedsMinor:
          payment.proceeds_minor == null
            ? null
            : payment.proceeds_minor - payment.refunded_amount_minor,
        createdAt: payment.created_at,
        succeededAt: payment.succeeded_at,
        userName: person?.full_name || guestName || null,
        userEmail: person?.email || guestEmail || null,
        refundable: Boolean(
          payment.provider === 'stripe' &&
          payment.stripe_payment_intent_id &&
          ['succeeded', 'partially_refunded'].includes(payment.status) &&
          remaining > 0,
        ),
      };
    });
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <AdminNav />
      {error && <FloatingFeedback error="Could not load payments. Please try again." />}
      <div className="page-container py-10">
        <p className="eyebrow">Administration</p>
        <h1 className="section-title">Payments</h1>
        {error ? null : (
          <AdminPaymentsWorkspace
            rows={rows}
            initialSettings={{
              interac_enabled: interacSettings?.interac_enabled ?? false,
              interac_recipient_email: interacSettings?.interac_recipient_email ?? '',
              interac_instructions: interacSettings?.interac_instructions ?? '',
            }}
          />
        )}
      </div>
    </main>
  );
}
