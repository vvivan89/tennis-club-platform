'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function useRefundForm(remainingMinor: number) {
  const defaultAmount = (remainingMinor / 100).toFixed(2);
  const [amount, setAmount] = useState(defaultAmount);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    setAmount((remainingMinor / 100).toFixed(2));
  }, [remainingMinor]);
  return {
    amount,
    setAmount,
    defaultAmount,
    busy,
    setBusy,
    message,
    setMessage,
    idempotencyKey,
    canSubmit:
      !busy &&
      remainingMinor > 0 &&
      Number.isFinite(Number(amount)) &&
      Number(amount) > 0 &&
      Math.round(Number(amount) * 100) <= remainingMinor,
  };
}

export function RefundAmountRow({
  inputId,
  amount,
  onAmountChange,
  maxAmount,
  inputLabel,
  inputAriaLabel,
  buttonTitle,
  buttonAriaLabel,
  disabled,
  onClick,
}: {
  inputId: string;
  amount: string;
  onAmountChange: (value: string) => void;
  maxAmount: string;
  inputLabel: string;
  inputAriaLabel: string;
  buttonTitle: string;
  buttonAriaLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <label className="sr-only" htmlFor={inputId}>
        {inputLabel}
      </label>
      <input
        id={inputId}
        aria-label={inputAriaLabel}
        className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        type="number"
        min="0.01"
        step="0.01"
        max={maxAmount}
        value={amount}
        onChange={(event) => onAmountChange(event.target.value)}
      />
      <Button
        size="icon"
        variant="outline"
        title={buttonTitle}
        aria-label={buttonAriaLabel}
        disabled={disabled}
        onClick={onClick}
      >
        <RotateCcw size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}

export function RefundStatusMessage({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="status" className="max-w-64 text-xs text-muted-foreground">
      {message}
    </p>
  );
}
