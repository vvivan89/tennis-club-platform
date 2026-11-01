'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { TennisLoader } from '@/components/tennis-loader';

type Option = { value: string; label: string };

export function RankingsCompetitionSelector({
  value,
  options,
}: {
  value: string;
  options: Option[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3" aria-busy={isPending}>
      <label className="flex flex-wrap items-center gap-3 text-sm font-medium">
        Competition
        <select
          aria-label="Competition"
          value={value}
          onChange={(event) => {
            const next = event.currentTarget.value;
            const [type, id] = next.includes(':') ? next.split(/:(.*)/s, 2) : ['season', next];
            startTransition(() =>
              router.push(
                type === 'tournament'
                  ? `/rankings?tournament=${encodeURIComponent(id)}`
                  : type === 'ladder'
                    ? `/rankings?ladder=${encodeURIComponent(id)}`
                    : type === 'league'
                      ? `/rankings?league=${encodeURIComponent(id)}`
                      : `/rankings?season=${encodeURIComponent(id)}`,
                { scroll: false },
              ),
            );
          }}
          className="h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All time</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {isPending && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[100] grid place-items-center bg-background/65 backdrop-blur-[2px]"
        >
          <div className="rounded-xl border border-border bg-card px-8 py-6 shadow-xl">
            <TennisLoader label="Updating rankings" />
          </div>
        </div>
      )}
    </div>
  );
}
