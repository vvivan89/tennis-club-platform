import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createPaymentServiceClient } from '@/lib/payments/server';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { MemberNav } from '@/components/member-nav';
import { Button } from '@/components/ui/button';
import { PaymentHistoryTable } from '@/components/payment-history-table';

export const dynamic = 'force-dynamic';

export default async function MemberPaymentsPage() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) redirect('/login?next=/member/payments');
  const db = createPaymentServiceClient();
  const [{ data: profile }, { data: payments, error }, { data: club }] = await Promise.all([
    db.from('profiles').select('application_status').eq('id', user.id).maybeSingle(),
    db
      .from('payments')
      .select(
        'id,purpose,business_record_id,amount_minor,currency,status,refunded_amount_minor,created_at,succeeded_at',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  if (profile?.application_status !== 'approved') redirect('/member/dashboard');

  let rows: Array<{
    id: string;
    purpose: string;
    eventName: string | null;
    amountMinor: number;
    currency: string;
    status: string;
    refundedAmountMinor: number;
    createdAt: string;
    succeededAt: string | null;
  }> = [];
  if (!error && payments?.length) {
    const registrationIds = [
      ...new Set(
        payments
          .filter(
            (payment) => payment.purpose === 'event_registration' && payment.business_record_id,
          )
          .map((payment) => payment.business_record_id as string),
      ),
    ];
    const { data: registrations } = registrationIds.length
      ? await db.from('registrations').select('id,event_id').in('id', registrationIds)
      : { data: [] };
    const registrationRows = (registrations ?? []) as Array<{ id: string; event_id: string }>;
    const eventIds = [...new Set(registrationRows.map((registration) => registration.event_id))];
    const { data: events } = eventIds.length
      ? await db.from('events').select('id,title').in('id', eventIds)
      : { data: [] };
    const eventRows = (events ?? []) as Array<{ id: string; title: string }>;
    const registrationById = new Map(registrationRows.map((item) => [item.id, item]));
    const eventById = new Map(eventRows.map((item) => [item.id, item]));
    rows = payments.map((payment) => {
      const registration =
        payment.purpose === 'event_registration' && payment.business_record_id
          ? registrationById.get(payment.business_record_id)
          : null;
      const event = registration ? eventById.get(registration.event_id) : null;
      return {
        id: payment.id,
        purpose: payment.purpose,
        eventName: event?.title ?? null,
        amountMinor: payment.amount_minor,
        currency: payment.currency,
        status: payment.status,
        refundedAmountMinor: payment.refunded_amount_minor,
        createdAt: payment.created_at,
        succeededAt: payment.succeeded_at,
      };
    });
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        clubName={club?.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club?.short_name || 'PCTC'}
      />
      <MemberNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Member account</p>
        <h1 className="section-title">Payment history</h1>
        {error ? (
          <p role="alert" className="mt-6 rounded-lg border border-destructive p-4 text-sm">
            Payment history is temporarily unavailable.
          </p>
        ) : rows.length ? (
          <PaymentHistoryTable rows={rows} />
        ) : (
          <p className="mt-6 rounded-xl border border-border p-5 text-sm text-muted-foreground">
            No payments found.
          </p>
        )}
        <div className="mt-6">
          <Button asChild variant="outline">
            <Link href="/member/membership">Back to membership</Link>
          </Button>
        </div>
      </div>
      <SiteFooter
        clubName={club?.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club?.short_name || 'PCTC'}
        socialLinks={
          Array.isArray(club?.social_links) ? (club.social_links as { url: string }[]) : []
        }
      />
    </main>
  );
}
