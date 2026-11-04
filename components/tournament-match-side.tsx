import Image from 'next/image';
import type { ReactNode } from 'react';

type TournamentMatchSideProps = {
  winner: boolean;
  logoUrl?: string | null;
  name: ReactNode;
  playerName?: string | null;
  isOwn: boolean;
};

export function TournamentMatchSide({
  winner,
  logoUrl,
  name,
  playerName,
  isOwn,
}: TournamentMatchSideProps) {
  return (
    <div className={`flex min-w-0 items-center gap-2 truncate ${winner ? 'font-semibold' : ''}`}>
      {logoUrl && (
        <Image
          src={logoUrl}
          alt=""
          width={24}
          height={24}
          unoptimized
          className="h-6 w-6 shrink-0 object-contain"
        />
      )}
      <span className="min-w-0 truncate">
        <span className="block truncate">{name}</span>
        {playerName && (
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {playerName}
          </span>
        )}
      </span>
      {isOwn && (
        <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
          You
        </span>
      )}
    </div>
  );
}
