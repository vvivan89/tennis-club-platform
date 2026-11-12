'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { useSiteHeaderState } from '@/components/site-header-state';

type PaymentStatus = {
  id: string;
  purpose: string;
  amount_minor: number;
  currency: string;
  status: string;
  succeeded_at: string | null;
};
type PaymentStatusResponse = { payment: PaymentStatus; fulfilled: boolean };

function PaymentReturnContent() {
  const { shortName } = useSiteHeaderState();
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const paymentId = params.get('payment_id');
  const canceled = params.get('canceled') === '1';
  const validatedReturnTo = safeRedirectPath(params.get('return_to'), '/member/payments');
  const returnTo = (() => {
    if (!canceled) return validatedReturnTo;
    const parsed = new URL(validatedReturnTo, 'https://pctc.invalid');
    parsed.searchParams.delete('guest_payment_ids');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  })();
  const returnLabel = (params.get('return_label') || 'Back').slice(0, 120);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [payment, setPayment] = useState<PaymentStatus | null>(null);
  const [fulfilled, setFulfilled] = useState(false);
  const [error, setError] = useState('');
  const [cancellationNotice, setCancellationNotice] = useState('');
  const [cancellationResolved, setCancellationResolved] = useState(!canceled || !paymentId);
  const [loading, setLoading] = useState(Boolean((sessionId || paymentId) && !canceled));

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (canceled && paymentId) {
      void fetch('/api/payments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, explicitCancel: true }),
      })
        .then(async (response) => {
          const result = await response.json().catch(() => ({}));
          if (!active) return;
          if (!response.ok) {
            setCancellationNotice(
              'The payment state could not be verified. Any provisional tournament entry was kept until its status can be confirmed.',
            );
          } else if (result.provisionalRegistrationRemoved) {
            setCancellationNotice(
              'Cancellation was confirmed and the provisional tournament registration was removed.',
            );
          } else {
            setCancellationNotice('Checkout cancellation was received.');
          }
          setCancellationResolved(true);
        })
        .catch(() => {
          if (active) {
            setCancellationNotice(
              'The payment state could not be verified. Any provisional tournament entry was kept until its status can be confirmed.',
            );
            setCancellationResolved(true);
          }
        });
      return () => {
        active = false;
      };
    }
    if ((!sessionId && !paymentId) || canceled)
      return () => {
        active = false;
      };
    let attempts = 0;
    const load = async () => {
      try {
        const reference = sessionId
          ? `session_id=${encodeURIComponent(sessionId)}`
          : `payment_id=${encodeURIComponent(paymentId!)}`;
        const response = await fetch(`/api/payments/status?${reference}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not retrieve payment status.');
        if (!active) return;
        setPayment(result.payment);
        setFulfilled(Boolean((result as PaymentStatusResponse).fulfilled));
        setError('');
        setLoading(false);
        if (
          (['pending', 'processing', 'failed'].includes(result.payment.status) ||
            (result.payment.status === 'succeeded' && !result.fulfilled)) &&
          attempts < 10
        ) {
          attempts++;
          timer = setTimeout(load, 2000);
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Could not retrieve payment status.');
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, paymentId, canceled]);

  const successful = payment?.status === 'succeeded' && fulfilled;
  useEffect(() => {
    if (!successful) {
      setCountdown(null);
      return;
    }
    setCountdown(10);
    const deadline = Date.now() + 10_000;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        window.location.assign(returnTo);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [successful, returnTo]);

  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency.toUpperCase() }).format(
      minor / 100,
    );
  let title = 'Payment status';
  let description = 'Your payment status is being checked with the server.';
  if (canceled) {
    title = 'Checkout canceled';
    description =
      'No payment confirmation was received. For non-member tournament entries, the provisional registration is removed only after Stripe confirms cancellation or expiry; if the payment state is uncertain, the entry is kept until it can be verified. You can return to the relevant page and try again.';
  } else if (payment?.status === 'succeeded' && fulfilled) {
    title = 'Payment successful';
    description = `Your payment of ${money(payment.amount_minor, payment.currency)} was confirmed by Stripe and applied to your ${payment.purpose === 'tournament_registration' ? 'tournament registration' : 'account'}.`;
  } else if (payment?.status === 'succeeded') {
    title = 'Payment confirmed — finalizing';
    description =
      'Stripe confirmed the payment. The membership or registration update is still processing. Keep this reference if you need to contact the club.';
  } else if (payment?.status === 'failed') {
    title = 'Payment failed';
    description = 'Stripe did not complete this payment. You can return and try again.';
  } else if (payment?.status === 'canceled') {
    title = 'Payment canceled';
    description = 'The payment was canceled or the Checkout Session expired.';
  } else if (payment?.status === 'refunded' || payment?.status === 'partially_refunded') {
    title = 'Payment refunded';
    description = 'The payment has a refund recorded.';
  } else if (payment?.status === 'pending' || payment?.status === 'processing' || loading) {
    title = 'Payment processing';
    description =
      'Stripe has not confirmed the final result yet. This page will refresh the status automatically.';
  } else if (error) {
    description = error;
  }

  return (
    <main className="page-container py-16">
      <section className="mx-auto max-w-xl rounded-xl border border-border p-6">
        <p className="eyebrow">{shortName ? `${shortName} payments` : 'Payments'}</p>
        <h1 className="section-title mt-2">{title}</h1>
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {description}
        </p>
        {cancellationNotice && (
          <p className="mt-2 text-sm" role="status">
            {cancellationNotice}
          </p>
        )}
        {payment && (
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <dt className="text-muted-foreground">Amount</dt>
            <dd>{money(payment.amount_minor, payment.currency)}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{payment.status.replaceAll('_', ' ')}</dd>
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="break-all">{payment.id}</dd>
          </dl>
        )}
        {successful && countdown !== null && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            Returning in {countdown} {countdown === 1 ? 'second' : 'seconds'}…
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button disabled={!cancellationResolved} onClick={() => window.location.assign(returnTo)}>
            {returnLabel}
          </Button>
        </div>
      </section>
    </main>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<main className="page-container py-16">Checking payment status…</main>}>
      <PaymentReturnContent />
    </Suspense>
  );
}
