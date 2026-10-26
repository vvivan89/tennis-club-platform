'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

export function AdminPaymentRefundForm({
  paymentId,
  remainingMinor,
}: {
  paymentId: string;
  remainingMinor: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((remainingMinor / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setAmount((remainingMinor / 100).toFixed(2));
  }, [remainingMinor]);
  const idempotencyKey = useRef(crypto.randomUUID());
  async function submit() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/payments/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          amountMinor: amount.trim() ? Math.round(Number(amount) * 100) : undefined,
          reason: 'requested_by_customer',
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Refund request failed.');
      setMessage(`Refund requested (${result.status}). Payment history has been refreshed.`);
      setAmount((remainingMinor / 100).toFixed(2));
      router.refresh();
      idempotencyKey.current = crypto.randomUUID();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refund request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <label className="sr-only" htmlFor={`refund-amount-${paymentId}`}>
          Refund amount
        </label>
        <input
          id={`refund-amount-${paymentId}`}
          aria-label={`Refund amount for ${paymentId}`}
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
          title="Request refund"
          aria-label={`Request refund for ${paymentId}`}
          disabled={
            busy ||
            remainingMinor <= 0 ||
            !Number.isFinite(Number(amount)) ||
            Number(amount) <= 0 ||
            Math.round(Number(amount) * 100) > remainingMinor
          }
          onClick={() => void submit()}
        >
          <RotateCcw size={16} aria-hidden="true" />
        </Button>
      </div>
      {message && (
        <p role="status" className="max-w-64 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
