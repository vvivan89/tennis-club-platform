import Image from 'next/image';

/** One consistent, privacy aware summary for a player across the app. */
export function UserIdentity({
  name,
  skillLevel,
  avatarUrl,
  birthdayVisible = false,
  className = '',
  compact = false,
}: {
  name: string | null | undefined;
  skillLevel?: number | string | null;
  avatarUrl?: string | null;
  birthdayVisible?: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`.trim()}>
      {avatarUrl && (
        <Image
          src={avatarUrl}
          alt=""
          width={compact ? 24 : 32}
          height={compact ? 24 : 32}
          unoptimized
          className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} shrink-0 rounded-full object-cover`}
        />
      )}
      <span className="truncate">{name?.trim() || 'Player'}</span>
      {skillLevel !== null && skillLevel !== undefined && skillLevel !== '' && (
        <span className="inline-flex shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {skillLevel}
        </span>
      )}
      {birthdayVisible && (
        <span role="img" aria-label="Birthday today" title="Birthday today">
          🎂
        </span>
      )}
    </span>
  );
}
