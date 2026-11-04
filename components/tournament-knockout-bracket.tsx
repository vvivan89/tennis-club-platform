import type { ReactNode } from 'react';
import type { Match } from '@/components/tournament-public-view-types';
import { dateLabel, phaseLabel } from '@/components/tournament-public-view-format';

type Props = {
  knockoutMatches: Match[];
  bracketStageLabel: (phase: string, round: number, maxRound: number) => string;
  bracketSideLabel: (match: Match, side: 1 | 2, maxRound: number) => string;
  format: string | null;
  pairSide: (match: Match, side: 1 | 2) => ReactNode;
};

export function TournamentKnockoutBracket({
  knockoutMatches,
  bracketStageLabel,
  bracketSideLabel,
  format,
  pairSide,
}: Props) {
  return (
    <>
      {knockoutMatches.length > 0 && (
        <details open className="space-y-3">
          <summary className="cursor-pointer text-lg font-semibold">Knockout bracket</summary>
          {[...new Set(knockoutMatches.map((match) => match.phase))].map((phase) => {
            const phaseMatches = knockoutMatches.filter((match) => match.phase === phase);
            const maxRound = Math.max(...phaseMatches.map((match) => match.round_number));
            return (
              <div key={phase} className="pb-2">
                <h4 className="mb-3 font-medium">{phaseLabel(phase)}</h4>
                {(() => {
                  const columnWidth = 256;
                  const columnGap = 64;
                  const slotHeight = 136;
                  const cardHeight = 112;
                  const firstRoundCount = Math.max(
                    1,
                    ...phaseMatches
                      .filter((match) => match.round_number === 1)
                      .map((match) => match.match_number),
                  );
                  const bracketHeight = 32 + firstRoundCount * slotHeight;
                  const bracketWidth = maxRound * columnWidth + (maxRound - 1) * columnGap;
                  const matchCenterY = (match: Match) =>
                    32 +
                    (match.match_number - 0.5) * Math.pow(2, match.round_number - 1) * slotHeight;
                  return (
                    <div className="overflow-x-auto pb-2">
                      <div
                        className="relative"
                        style={{ width: `${bracketWidth}px`, height: `${bracketHeight}px` }}
                      >
                        <svg
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-0 overflow-visible"
                          width={bracketWidth}
                          height={bracketHeight}
                          viewBox={`0 0 ${bracketWidth} ${bracketHeight}`}
                          fill="none"
                        >
                          {phaseMatches
                            .filter((match) => match.round_number < maxRound)
                            .map((match) => {
                              const nextMatchNumber = Math.ceil(match.match_number / 2);
                              const nextMatch = phaseMatches.find(
                                (candidate) =>
                                  candidate.round_number === match.round_number + 1 &&
                                  candidate.match_number === nextMatchNumber,
                              );
                              if (!nextMatch) return null;
                              const xStart =
                                (match.round_number - 1) * (columnWidth + columnGap) + columnWidth;
                              const xMid = xStart + columnGap / 2;
                              const xEnd = xStart + columnGap;
                              const yStart = matchCenterY(match);
                              const yEnd = matchCenterY(nextMatch);
                              return (
                                <path
                                  key={`advance-${match.id}`}
                                  d={`M ${xStart} ${yStart} H ${xMid} V ${yEnd} H ${xEnd}`}
                                  stroke="currentColor"
                                  strokeOpacity="0.35"
                                  strokeWidth="1.5"
                                />
                              );
                            })}
                        </svg>
                        {Array.from({ length: maxRound }, (_, index) => index + 1).map((round) => (
                          <div
                            key={round}
                            className="absolute top-0 z-10"
                            style={{
                              left: `${(round - 1) * (columnWidth + columnGap)}px`,
                              width: `${columnWidth}px`,
                              height: `${bracketHeight}px`,
                            }}
                          >
                            <p className="absolute left-0 top-0 h-5 text-xs font-semibold uppercase leading-5 tracking-wide text-muted-foreground">
                              {bracketStageLabel(phase, round, maxRound)}
                            </p>
                            {phaseMatches
                              .filter((match) => match.round_number === round)
                              .map((match) => (
                                <article
                                  key={match.id}
                                  className="absolute left-0 w-64 overflow-hidden rounded-lg border border-border bg-card p-2.5 shadow-sm"
                                  style={{
                                    top: `${matchCenterY(match) - cardHeight / 2}px`,
                                    minHeight: `${cardHeight}px`,
                                  }}
                                >
                                  <p className="mb-1.5 text-[10px] text-muted-foreground">
                                    {bracketStageLabel(phase, round, maxRound)} {match.match_number}
                                  </p>
                                  {[1, 2].map((side) => {
                                    const isOne = side === 1;
                                    const scoreSets = match.score_sets ?? [];
                                    const isWalkover =
                                      scoreSets.length === 0 && match.status === 'completed';
                                    const winner = match.winner_side === side;
                                    const playerLabel = bracketSideLabel(
                                      match,
                                      side as 1 | 2,
                                      maxRound,
                                    );
                                    return (
                                      <div
                                        key={`${match.id}-side-${side}`}
                                        className={`grid items-center gap-1 ${isOne ? 'mb-1' : ''} ${winner ? 'rounded bg-emerald-600/10 font-semibold' : ''}`}
                                        style={{
                                          gridTemplateColumns: `repeat(${scoreSets.length || 1}, 1.75rem) minmax(0,1fr)`,
                                        }}
                                      >
                                        {isWalkover && (
                                          <span
                                            className={`relative flex h-8 items-center justify-center rounded border border-border text-[15px] font-mono ${
                                              winner ? 'font-bold' : ''
                                            }`}
                                          >
                                            {winner ? (
                                              <>
                                                <span className="absolute left-[2px] top-[2px]  leading-none">
                                                  W
                                                </span>
                                                <span className="absolute inset-0 flex items-center justify-center text-xs font-normal">
                                                  /
                                                </span>
                                                <span className="absolute bottom-[2px] right-[2px] leading-none">
                                                  O
                                                </span>
                                              </>
                                            ) : (
                                              '-'
                                            )}
                                          </span>
                                        )}
                                        {scoreSets.map((set, index) => {
                                          const score = isOne ? set.one : set.two;
                                          const opponentScore = isOne ? set.two : set.one;
                                          return (
                                            <span
                                              key={`${match.id}-${side}-set-${index}`}
                                              className={`rounded border border-border px-1 py-1 text-center text-[15px] font-mono tabular-nums ${score > opponentScore ? 'font-bold' : ''}`}
                                            >
                                              {score}
                                            </span>
                                          );
                                        })}
                                        <span className="min-w-0 truncate rounded px-1.5 py-1 text-xs">
                                          {format !== 'team' && pairSide(match, isOne ? 1 : 2)
                                            ? pairSide(match, isOne ? 1 : 2)
                                            : playerLabel}
                                        </span>
                                      </div>
                                    );
                                  })}
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    {match.status === 'bye'
                                      ? 'BYE — automatic advancement'
                                      : (dateLabel(match.scheduled_at) ??
                                        'Walkover / result recorded')}
                                  </p>
                                </article>
                              ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </details>
      )}
    </>
  );
}
