'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function AdminPaymentRefundForm({
  paymentId,
  remainingMinor,
}: {
  paymentId: string;
  remainingMinor: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
      setAmount('');
      router.refresh();
      idempotencyKey.current = crypto.randomUUID();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refund request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-w-56 space-y-2">
      <label className="block text-xs text-muted-foreground">
        Partial amount in currency units (blank = full remaining balance)
      </label>
      <input
        aria-label={`Refund amount for ${paymentId}`}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        type="number"
        min="0.01"
        step="0.01"
        max={(remainingMinor / 100).toFixed(2)}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={
          busy ||
          remainingMinor <= 0 ||
          (amount.trim() !== '' &&
            (!Number.isFinite(Number(amount)) ||
              Number(amount) <= 0 ||
              Math.round(Number(amount) * 100) > remainingMinor))
        }
        onClick={() => void submit()}
      >
        {busy ? 'Requesting…' : 'Request refund'}
      </Button>
      {message && (
        <p role="status" className="max-w-72 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
