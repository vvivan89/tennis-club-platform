'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FloatingFeedback } from '@/components/floating-feedback';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useSiteHeaderState } from '@/components/site-header-state';
import { RefundAmountRow, useRefundForm } from '@/components/refund-form-parts';

export function AdminManualPaymentRefundForm({
  paymentId,
  remainingMinor,
}: {
  paymentId: string;
  remainingMinor: number;
}) {
  const { shortName } = useSiteHeaderState();
  const router = useRouter();
  const form = useRefundForm(remainingMinor);
  const { amount, idempotencyKey } = form;
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  async function submit() {
    setConfirmOpen(false);
    form.setBusy(true);
    form.setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/payments/manual-refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          amountMinor: Math.round(Number(amount) * 100),
          note: note.trim() || undefined,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not record manual refund.');
      form.setMessage(
        `Refund recorded: ${(result.amountMinor / 100).toLocaleString('en-CA', { style: 'currency', currency: (result.currency || 'CAD').toUpperCase() })}.`,
      );
      idempotencyKey.current = crypto.randomUUID();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not record manual refund.');
    } finally {
      form.setBusy(false);
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <RefundAmountRow
        inputId={`manual-refund-amount-${paymentId}`}
        amount={amount}
        onAmountChange={form.setAmount}
        maxAmount={form.defaultAmount}
        inputLabel="Manual refund amount"
        inputAriaLabel={`Manual refund amount for ${paymentId}`}
        buttonTitle="Record manual refund"
        buttonAriaLabel={`Record manual refund for ${paymentId}`}
        disabled={!form.canSubmit}
        onClick={() => setConfirmOpen(true)}
      />
      <label className="sr-only" htmlFor={`manual-refund-note-${paymentId}`}>
        Manual refund note
      </label>
      <input
        id={`manual-refund-note-${paymentId}`}
        aria-label={`Manual refund note for ${paymentId}`}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
        maxLength={500}
        placeholder="Optional refund note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <FloatingFeedback error={error} message={form.message} />
      <ConfirmDialog
        open={confirmOpen}
        title="Record manual Interac refund?"
        description={`Record a manual Interac refund of $${Number(amount || 0).toFixed(2)}? This records the refund${shortName ? ` in ${shortName}` : ''}; it does not send money.`}
        confirmLabel="Record refund"
        destructive
        busy={form.busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </div>
  );
}
