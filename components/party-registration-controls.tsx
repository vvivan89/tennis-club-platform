'use client';

import { Button } from '@/components/ui/button';
import { TennisLoader } from '@/components/tennis-loader';

export function EventActionFeedback({ error, message }: { error: string; message: string }) {
  if (!error && !message) return null;
  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] w-[min(24rem,calc(100vw-2rem))]"
      aria-live="polite"
    >
      {error && (
        <p
          role="alert"
          className="pointer-events-auto rounded-md border border-destructive/30 bg-background p-3 text-sm text-destructive shadow-lg"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="pointer-events-auto mt-2 rounded-md border border-success/30 bg-background p-3 text-sm shadow-lg"
        >
          {message}
        </p>
      )}
    </div>
  );
}

export function EventPaymentPendingNotices({
  interacAmount,
  paymentPending,
}: {
  interacAmount: string | null;
  paymentPending: boolean;
}) {
  const style =
    'basis-full rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning-foreground dark:bg-warning/30 dark:text-warning-foreground';
  return (
    <>
      {interacAmount && (
        <p role="status" className={style}>
          Interac payment requested: {interacAmount}. Awaiting club confirmation.
        </p>
      )}
      {paymentPending && (
        <p role="status" className={style}>
          Your place is reserved while payment is pending. If payment is not completed, you may be
          removed from the participant list.
        </p>
      )}
    </>
  );
}

export function PartyGuestFee({ priceCents }: { priceCents: number }) {
  return (
    <span className="text-sm text-muted-foreground">
      {priceCents === 0
        ? '+1 guest included'
        : `+${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(priceCents / 100)} per guest`}
    </span>
  );
}

export function PartyRegistrationButtons({
  busy,
  onRegister,
}: {
  busy: boolean;
  onRegister: (withGuest: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => onRegister(false)}>
        {busy ? <TennisLoader compact label="Working" /> : 'Register myself'}
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => onRegister(true)}>
        {busy ? <TennisLoader compact label="Working" /> : 'Register with +1'}
      </Button>
    </div>
  );
}
