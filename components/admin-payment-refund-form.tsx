'use client';

import { useRouter } from 'next/navigation';
import {
  RefundAmountRow,
  RefundStatusMessage,
  useRefundForm,
} from '@/components/refund-form-parts';

export function AdminPaymentRefundForm({
  paymentId,
  remainingMinor,
}: {
  paymentId: string;
  remainingMinor: number;
}) {
  const router = useRouter();
  const form = useRefundForm(remainingMinor);
  const { amount, idempotencyKey } = form;
  async function submit() {
    form.setBusy(true);
    form.setMessage('');
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
      form.setMessage(`Refund requested (${result.status}). Payment history has been refreshed.`);
      form.setAmount(form.defaultAmount);
      router.refresh();
      idempotencyKey.current = crypto.randomUUID();
    } catch (error) {
      form.setMessage(error instanceof Error ? error.message : 'Refund request failed.');
    } finally {
      form.setBusy(false);
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <RefundAmountRow
        inputId={`refund-amount-${paymentId}`}
        amount={amount}
        onAmountChange={form.setAmount}
        maxAmount={form.defaultAmount}
        inputLabel="Refund amount"
        inputAriaLabel={`Refund amount for ${paymentId}`}
        buttonTitle="Request refund"
        buttonAriaLabel={`Request refund for ${paymentId}`}
        disabled={!form.canSubmit}
        onClick={() => void submit()}
      />
      <RefundStatusMessage message={form.message} />
    </div>
  );
}
