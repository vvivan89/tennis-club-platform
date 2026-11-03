'use client';

export function PendingTournamentInvitationBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${count} pending tournament invitation${count === 1 ? '' : 's'}`}
      title={`${count} pending tournament invitation${count === 1 ? '' : 's'}`}
      className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
    >
      {count}
    </span>
  );
}
