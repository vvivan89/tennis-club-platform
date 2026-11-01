import { ConfirmDialog } from '@/components/confirm-dialog';

export type InteracPaymentNotice = {
  amount: string;
  recipientEmail: string;
  paymentId: string;
  instructions: string;
  message: string;
};

export function InteracPaymentInstructionsDialog({
  notice,
  onClose,
}: {
  notice: InteracPaymentNotice | null;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!notice}
      title="Interac e-Transfer instructions"
      description={
        notice ? (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Your payment request has been created. Send the amount below by e-Transfer.
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Amount to send
              </p>
              <p className="mt-1 text-xl font-semibold">{notice.amount}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Send to
              </p>
              <p className="mt-1 break-all font-medium">{notice.recipientEmail}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Payment reference
              </p>
              <p className="mt-1 break-all font-mono text-xs">{notice.paymentId}</p>
            </div>
            {notice.instructions.trim() && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4">
                <p className="mb-2 text-sm font-semibold text-primary">
                  Payment instructions from the club
                </p>
                <p className="whitespace-pre-line leading-relaxed">{notice.instructions}</p>
              </div>
            )}
            {notice.message && <p className="text-sm text-muted-foreground">{notice.message}</p>}
          </div>
        ) : null
      }
      confirmLabel="Got it"
      onConfirm={onClose}
      onCancel={onClose}
    />
  );
}
