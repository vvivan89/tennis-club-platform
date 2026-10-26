'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';

export function AdminManualPaymentRefundForm({
  paymentId,
  remainingMinor,
}: {
  paymentId: string;
  remainingMinor: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((remainingMinor / 100).toFixed(2));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  useEffect(() => setAmount((remainingMinor / 100).toFixed(2)), [remainingMinor]);
  async function submit() {
    setConfirmOpen(false);
    setBusy(true);
    setMessage('');
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
      setMessage(
        `Refund recorded: ${(result.amountMinor / 100).toLocaleString('en-CA', { style: 'currency', currency: (result.currency || 'CAD').toUpperCase() })}.`,
      );
      idempotencyKey.current = crypto.randomUUID();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not record manual refund.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <label className="sr-only" htmlFor={`manual-refund-amount-${paymentId}`}>
          Manual refund amount
        </label>
        <input
          id={`manual-refund-amount-${paymentId}`}
          aria-label={`Manual refund amount for ${paymentId}`}
          className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          type="number"
          min="0.01"
          step="0.01"
          max={(remainingMinor / 100).toFixed(2)}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button
          size="icon"
          variant="outline"
          title="Record manual refund"
          aria-label={`Record manual refund for ${paymentId}`}
          disabled={
            busy ||
            remainingMinor <= 0 ||
            !Number.isFinite(Number(amount)) ||
            Number(amount) <= 0 ||
            Math.round(Number(amount) * 100) > remainingMinor
          }
          onClick={() => setConfirmOpen(true)}
        >
          <RotateCcw size={16} aria-hidden="true" />
        </Button>
      </div>
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
      {message && (
        <p role="status" className="max-w-64 text-xs text-muted-foreground">
          {message}
        </p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="Record manual Interac refund?"
        description={`Record a manual Interac refund of $${Number(amount || 0).toFixed(2)}? This records the refund in PCTC; it does not send money.`}
        confirmLabel="Record refund"
        destructive
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </div>
  );
}
