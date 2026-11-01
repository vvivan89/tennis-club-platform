import { Button } from '@/components/ui/button';
import { TennisLoader } from '@/components/tennis-loader';

export function EventWithdrawalDialog({
  eventId,
  open,
  busy,
  onCancel,
  onConfirm,
  stopPropagation = false,
}: {
  eventId: string;
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  stopPropagation?: boolean;
}) {
  if (!open) return null;
  const titleId = `withdraw-title-${eventId}`;
  const descriptionId = `withdraw-description-${eventId}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (stopPropagation) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (!busy) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-xl border border-border bg-background p-6 text-left shadow-xl"
        onClick={(event) => {
          if (stopPropagation) event.preventDefault();
          event.stopPropagation();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Withdraw from this event?
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">
          If you withdraw, you will lose your current place. If you register again later, you may
          need to join the waitlist, and your previous place will not be restored.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Keep my place
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-red-500/70 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <TennisLoader compact label="Withdrawing" /> : 'Confirm withdrawal'}
          </Button>
        </div>
      </section>
    </div>
  );
}
