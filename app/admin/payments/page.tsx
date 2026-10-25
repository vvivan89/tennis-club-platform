import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createPaymentServiceClient } from '@/lib/payments/server';
import { AdminNav } from '@/components/admin-nav';
import { PaymentHistoryTable } from '@/components/payment-history-table';
import { syncPaymentProceeds } from '@/lib/payments/proceeds';

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
  const { data: payments, error } = await db
    .from('payments')
    .select(
      'id,user_id,purpose,business_record_id,amount_minor,currency,status,refunded_amount_minor,created_at,succeeded_at,stripe_payment_intent_id,stripe_fee_minor,proceeds_minor',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  let rows: Array<{
    id: string;
    purpose: string;
    eventName: string | null;
    amountMinor: number;
    currency: string;
    status: string;
    refundedAmountMinor: number;
    proceedsMinor: number | null;
    createdAt: string;
    succeededAt: string | null;
    userName: string | null;
    userEmail: string | null;
    refundable: boolean;
  }> = [];

  if (!error && payments?.length) {
    const userIds = [...new Set(payments.map((payment) => payment.user_id).filter(Boolean))];
    const registrationIds = [
      ...new Set(
        payments
          .filter(
            (payment) => payment.purpose === 'event_registration' && payment.business_record_id,
          )
          .map((payment) => payment.business_record_id as string),
      ),
    ];
    const [{ data: profiles }, { data: registrations }] = await Promise.all([
      userIds.length
        ? db.from('profiles').select('id,full_name,email').in('id', userIds)
        : Promise.resolve({ data: [] }),
      registrationIds.length
        ? db.from('registrations').select('id,event_id').in('id', registrationIds)
        : Promise.resolve({ data: [] }),
    ]);
    const profileRows = (profiles ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>;
    const registrationRows = (registrations ?? []) as Array<{ id: string; event_id: string }>;
    const eventIds = [...new Set(registrationRows.map((registration) => registration.event_id))];
    const { data: events } = eventIds.length
      ? await db.from('events').select('id,title').in('id', eventIds)
      : { data: [] };
    const eventRows = (events ?? []) as Array<{ id: string; title: string }>;
    const profileById = new Map(profileRows.map((item) => [item.id, item]));
    const registrationById = new Map(registrationRows.map((item) => [item.id, item]));
    const eventById = new Map(eventRows.map((item) => [item.id, item]));

    await Promise.all(
      payments
        .filter(
          (payment) =>
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
      const registration =
        payment.purpose === 'event_registration' && payment.business_record_id
          ? registrationById.get(payment.business_record_id)
          : null;
      const event = registration ? eventById.get(registration.event_id) : null;
      const remaining = payment.amount_minor - payment.refunded_amount_minor;
      return {
        id: payment.id,
        purpose: payment.purpose,
        eventName: event?.title ?? null,
        amountMinor: payment.amount_minor,
        currency: payment.currency,
        status: payment.status,
        refundedAmountMinor: payment.refunded_amount_minor,
        proceedsMinor:
          payment.proceeds_minor == null
            ? null
            : payment.proceeds_minor - payment.refunded_amount_minor,
        createdAt: payment.created_at,
        succeededAt: payment.succeeded_at,
        userName: person?.full_name ?? null,
        userEmail: person?.email ?? null,
        refundable: Boolean(
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
      <div className="page-container py-10">
        <p className="eyebrow">Administration</p>
        <h1 className="section-title">Payments</h1>
        {error ? (
          <p role="alert" className="mt-6 rounded-lg border border-destructive p-4 text-sm">
            Could not load payments.
          </p>
        ) : (
          <PaymentHistoryTable rows={rows} admin />
        )}
      </div>
    </main>
  );
}
