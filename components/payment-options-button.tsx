'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TennisLoader } from '@/components/tennis-loader';

export type PaymentOption = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
};

export function PaymentOptionsButton({
  options,
  disabled = false,
  className,
}: {
  options: PaymentOption[];
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const singleOption = options.length === 1 ? options[0] : null;
  const allDisabled = options.length === 0 || options.every((option) => option.disabled);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const runOption = (option: PaymentOption) => {
    if (option.disabled || option.loading) return;
    setOpen(false);
    option.onSelect();
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <Button
        type="button"
        disabled={disabled || allDisabled}
        aria-haspopup={singleOption ? undefined : 'menu'}
        aria-expanded={singleOption ? undefined : open}
        className={className}
        onClick={() => {
          if (singleOption) runOption(singleOption);
          else setOpen((value) => !value);
        }}
      >
        {singleOption?.loading ? (
          <TennisLoader compact label={singleOption.loadingLabel || 'Starting payment'} />
        ) : (
          <>
            Pay
            {!singleOption && <ChevronDown aria-hidden="true" className="ml-2 h-4 w-4" />}
          </>
        )}
      </Button>
      {open && !singleOption && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 min-w-64 rounded-md border border-border bg-background p-1 shadow-lg"
        >
          {options.map((option, index) => (
            <button
              key={`${option.label}-${index}`}
              type="button"
              role="menuitem"
              disabled={option.disabled || option.loading}
              className="flex min-h-10 w-full items-center rounded-sm px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => runOption(option)}
            >
              {option.loading ? (
                <TennisLoader compact label={option.loadingLabel || 'Starting payment'} />
              ) : (
                option.label
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
