import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventInfo } from '@/components/event-detail-types';
import type { InteracPaymentNotice } from '@/components/interac-payment-instructions-dialog';
import { registrationErrorMessage } from '@/lib/registration-error-message';

type RouterRefresh = () => void;

export function useEventRegistrationActions({
  db,
  event,
  currentUserId,
  liveRegistrationId,
  livePaymentStatus,
  operationKeys,
  setLiveRegistrationId,
  setLiveStatus,
  setLivePaymentStatus,
  setBusy,
  setError,
  setMessage,
  setPendingInteracNotice,
  setInteracNotice,
  setPendingCardPayment,
  refreshRoster,
  notifyInBackground,
  refreshPage,
}: {
  db: SupabaseClient;
  event: EventInfo;
  currentUserId: string | null;
  liveRegistrationId: string | null;
  livePaymentStatus: string | null;
  operationKeys: MutableRefObject<Record<string, string>>;
  setLiveRegistrationId: Dispatch<SetStateAction<string | null>>;
  setLiveStatus: Dispatch<SetStateAction<string | null>>;
  setLivePaymentStatus: Dispatch<SetStateAction<string | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingInteracNotice: Dispatch<SetStateAction<InteracPaymentNotice | null>>;
  setInteracNotice: Dispatch<SetStateAction<InteracPaymentNotice | null>>;
  setPendingCardPayment: Dispatch<SetStateAction<boolean>>;
  refreshRoster: () => Promise<void>;
  notifyInBackground: () => void;
  refreshPage: RouterRefresh;
}) {
  async function startEventCheckout(
    registrationId: string,
    provider: 'stripe' | 'interac' = 'stripe',
  ) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'event_registration',
          provider,
          businessRecordId: registrationId,
          idempotencyKey: crypto.randomUUID(),
          returnTo: `/events/${event.slug || event.id}`,
          returnLabel: `Back to ${event.title}`,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start checkout.');
      if (provider === 'interac') {
        const notice: InteracPaymentNotice = {
          amount: (Number(result.amountMinor) / 100).toLocaleString('en-CA', {
            style: 'currency',
            currency: 'CAD',
          }),
          recipientEmail: result.recipientEmail,
          paymentId: result.paymentId,
          instructions: result.instructions || '',
          message: result.message || '',
        };
        setInteracNotice(notice);
        setPendingInteracNotice(notice);
        setMessage(
          'Interac payment request submitted. Your registration remains unpaid until the club confirms receipt.',
        );
        setLivePaymentStatus('pending');
        refreshPage();
        return;
      }
      if (!result.checkoutUrl) throw new Error('Could not start checkout.');
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      console.error('[Event detail] Checkout creation failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      setError(
        error instanceof Error
          ? error.message
          : 'Registration is reserved, but payment could not be started. Please try again.',
      );
      setMessage('Your registration is reserved, but payment is still required.');
    } finally {
      setBusy(false);
    }
  }

  async function checkEventPaymentStatus(registrationId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(
        `/api/payments/status?registration_id=${encodeURIComponent(registrationId)}`,
        { cache: 'no-store' },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not check payment status.');
      if (!result.payment) {
        await startEventCheckout(registrationId);
        return;
      }
      const status = String(result.payment.status || 'pending');
      if (status === 'succeeded' && result.fulfilled) {
        setLivePaymentStatus('paid');
        setMessage('Payment confirmed. Your registration is complete.');
        await refreshRoster();
        refreshPage();
        return;
      }
      const paymentStatus = status === 'succeeded' || status === 'processing' ? 'pending' : status;
      setLivePaymentStatus(paymentStatus);
      if (status === 'failed' || status === 'canceled') setPendingCardPayment(false);
      if (result.checkoutUrl && status === 'pending') {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (status === 'succeeded')
        setMessage('Payment confirmed. Your registration is being finalized. Check again shortly.');
      else if (status === 'failed' || status === 'canceled')
        setMessage('The previous payment was not completed. You can try paying the fee again.');
      else
        setMessage(
          'Payment is still pending. If you just completed checkout, check again shortly.',
        );
      await refreshRoster();
      refreshPage();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not check payment status.');
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const operation = `register:${event.id}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      const { data, error } = await db.rpc('register_for_event', {
        p_event_id: event.id,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      delete operationKeys.current[operation];
      const result = data?.[0];
      let paymentStatus: string | null = null;
      if (result?.registration_id) {
        const { data: created, error: createdError } = await db
          .from('registrations')
          .select('payment_status')
          .eq('id', result.registration_id)
          .eq('user_id', currentUserId ?? '')
          .maybeSingle();
        if (createdError) throw createdError;
        paymentStatus = created?.payment_status ?? null;
        setLiveRegistrationId(result.registration_id);
        setLiveStatus(result.registration_state);
        setLivePaymentStatus(paymentStatus ?? (event.price_cents > 0 ? 'pending' : 'not_required'));
      }
      if (
        event.price_cents > 0 &&
        result?.registration_state === 'confirmed' &&
        result?.registration_id &&
        paymentStatus !== 'paid'
      ) {
        await startEventCheckout(result.registration_id);
        return;
      }
      await refreshRoster();
      const message =
        result?.registration_state === 'waitlisted'
          ? `Added to the waitlist at position ${result?.position_in_waitlist ?? '—'}.`
          : paymentStatus === 'paid'
            ? 'Registration confirmed. Your previous tournament payment has been applied.'
            : 'Registration confirmed.';
      setMessage(message);
      notifyInBackground();
      refreshPage();
    } catch (error) {
      console.error('[Event detail] Database registration failed', error);
      setError(registrationErrorMessage(error, event.gender_restriction));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!liveRegistrationId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (
        event.price_cents > 0 &&
        livePaymentStatus !== 'paid' &&
        livePaymentStatus !== 'not_required'
      ) {
        const response = await fetch('/api/payments/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: liveRegistrationId }),
        });
        const result = await response.json();
        if (!response.ok) {
          setError(result.error || 'Could not cancel the pending payment.');
          return;
        }
      }
      const operation = `withdraw:${liveRegistrationId}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      const { error } = await db.rpc('withdraw_from_event', {
        p_registration_id: liveRegistrationId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      delete operationKeys.current[operation];
      setLiveRegistrationId(null);
      setLiveStatus('cancelled');
      await refreshRoster();
      setMessage('Registration withdrawn. The waitlist has been updated.');
      notifyInBackground();
      refreshPage();
    } catch (error) {
      console.error('[Event detail] Database withdrawal failed', error);
      setError('Could not update registration. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return { startEventCheckout, checkEventPaymentStatus, register, withdraw };
}
