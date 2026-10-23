'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TennisLoader } from '@/components/tennis-loader';

export function SeasonSelector({
  path,
  season,
  years,
}: {
  path: string;
  season: string;
  years: number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function changeSeason(value: string) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('season', value);
    startTransition(() => router.push(`${url.pathname}${url.search}`, { scroll: false }));
  }
  return (
    <div className="relative flex items-center gap-2">
      <label htmlFor={`season-${path.replace(/[^a-z]/gi, '')}`} className="text-sm font-medium">
        Season
      </label>
      <select
        id={`season-${path.replace(/[^a-z]/gi, '')}`}
        value={season}
        onChange={(event) => changeSeason(event.target.value)}
        disabled={pending}
        aria-busy={pending}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-70"
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
        <option value="all">All time</option>
      </select>
      {pending && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-background/65 backdrop-blur-[2px]">
          <div className="rounded-xl border border-border bg-card px-8 py-6 shadow-xl">
            <TennisLoader label="Updating results" />
          </div>
        </div>
      )}
    </div>
  );
}
