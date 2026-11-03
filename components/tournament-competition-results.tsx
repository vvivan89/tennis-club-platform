import type { TournamentConfig } from '@/lib/tournament-config';
import { knockoutStageLabel } from '@/lib/tournament-config';
import { compareByScheduleThenCourt } from '@/lib/tournament-match';
import { formatTime } from '@/lib/time-format';
import { LeagueEventStandings } from '@/components/league-event-standings';
import { TournamentPublicGroupStandingsPanel } from '@/components/tournament-public-group-standings-panel';
import type {
  GroupOverride,
  Match,
  Participant,
  Team,
} from '@/components/tournament-public-view-types';
import type { GroupStanding } from '@/components/tournament-public-group-standings';
import { dateLabel, phaseLabel } from '@/components/tournament-public-view-format';

type Props = {
  leagueTournament: boolean;
  leagueStandingsBefore: Array<Record<string, unknown>>;
  leagueStandingsAfter: Array<Record<string, unknown>>;
  leagueHasResults: boolean;
  knockoutMatches: Match[];
  bracketStageLabel: (phase: string, round: number, maxRound: number) => string;
  bracketSideLabel: (match: Match, side: 1 | 2, maxRound: number) => string;
  categoryVisibleMatches: Match[];
  format: string | null;
  activeCategory: string;
  groupStandings: GroupStanding[];
  rankingColumns: string[];
  rankingColumnLabel: Record<string, string>;
  isOwnCompetitionEntry: (entryId: string) => boolean;
  groupOverrides: GroupOverride[];
  enabledPhases: NonNullable<TournamentConfig['phases']>;
  config: TournamentConfig | null;
  hasAdminContent: boolean;
  openGroupOverrideEditor: (group: GroupStanding) => void;
  resultsOnly: boolean;
  competitionMatchGrouping: 'group' | 'round';
  setCompetitionMatchGrouping: (mode: 'group' | 'round') => void;
  participants: Participant[];
  teams: Team[];
  currentUserId: string | null;
  matchPlayers: Array<{
    match_id: string;
    participant_id: string;
    side: number;
    team_id: string | null;
  }>;
  saveCaptainPairing: (match: Match, teamId: string, side: 1 | 2) => void;
  saveCaptainScore: (match: Match) => void;
  isOwnPair: (pairId: string | null | undefined) => boolean;
  ownTeamIds: string[];
  roundRobinRoundByMatch: Map<string, number>;
};

export function TournamentCompetitionResults({
  leagueTournament,
  leagueStandingsBefore,
  leagueStandingsAfter,
  leagueHasResults,
  knockoutMatches,
  bracketStageLabel,
  bracketSideLabel,
  categoryVisibleMatches,
  format,
  activeCategory,
  groupStandings,
  rankingColumns,
  rankingColumnLabel,
  isOwnCompetitionEntry,
  groupOverrides,
  enabledPhases,
  config,
  hasAdminContent,
  openGroupOverrideEditor,
  resultsOnly,
  competitionMatchGrouping,
  setCompetitionMatchGrouping,
  participants,
  teams,
  currentUserId,
  matchPlayers,
  saveCaptainPairing,
  saveCaptainScore,
  isOwnPair,
  ownTeamIds,
  roundRobinRoundByMatch,
}: Props) {
  return (
    <div className="space-y-6">
      {leagueTournament && (
        <LeagueEventStandings
          before={leagueStandingsBefore}
          after={leagueStandingsAfter}
          hasResults={leagueHasResults}
        />
      )}
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
                                          {playerLabel}
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
      <TournamentPublicGroupStandingsPanel
        groupStandings={groupStandings}
        format={format}
        activeCategory={activeCategory}
        hasAdminControls={hasAdminContent}
        onOverride={openGroupOverrideEditor}
        rankingColumns={rankingColumns}
        rankingColumnLabel={rankingColumnLabel}
        isOwnEntry={isOwnCompetitionEntry}
        groupOverrides={groupOverrides}
        enabledPhases={enabledPhases}
        config={config}
        visibleMatches={categoryVisibleMatches}
      />
      {!resultsOnly &&
        (categoryVisibleMatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No matches have been scheduled for this category yet.
          </p>
        ) : (
          <details open className="space-y-3">
            <summary className="cursor-pointer text-lg font-semibold">
              Match schedule and results
            </summary>
            {!leagueTournament &&
              categoryVisibleMatches.some((match) => match.phase.includes('round_robin')) && (
                <div
                  className="inline-flex rounded-md border border-border p-1"
                  role="group"
                  aria-label="Group round-robin matches by"
                >
                  {(['group', 'round'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={competitionMatchGrouping === mode}
                      onClick={() => setCompetitionMatchGrouping(mode)}
                      className={`rounded px-3 py-2 text-sm ${competitionMatchGrouping === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
                    >
                      By {mode}
                    </button>
                  ))}
                </div>
              )}
            {([format === 'team' ? 'team' : activeCategory] as const)
              .filter((category) => categoryVisibleMatches.some((m) => m.category === category))
              .map((category) => (
                <div key={category} className="space-y-3">
                  {[
                    'preliminary_knockout',
                    'final_knockout',
                    'team_knockout',
                    'round_robin',
                    'team_round_robin',
                  ]
                    .filter((phase) =>
                      categoryVisibleMatches.some(
                        (m) => m.category === category && m.phase === phase,
                      ),
                    )
                    .map((phase) => (
                      <div key={phase}>
                        {!leagueTournament && <h4 className="font-medium">{phaseLabel(phase)}</h4>}
                        {(() => {
                          const phaseMatches = categoryVisibleMatches
                            .filter((m) => m.category === category && m.phase === phase)
                            .sort((a, b) => {
                              if (phase.includes('knockout') && a.round_number !== b.round_number)
                                return a.round_number - b.round_number;
                              return compareByScheduleThenCourt(a, b);
                            });
                          const isRoundRobin = phase.includes('round_robin');
                          const isKnockout = phase.includes('knockout');
                          const stageCount = Math.max(
                            1,
                            ...phaseMatches.map((m) => m.round_number),
                          );
                          const grouped = isRoundRobin
                            ? Array.from(
                                new Set<string>(
                                  phaseMatches.map((m) =>
                                    competitionMatchGrouping === 'group'
                                      ? `Group ${m.group_number ?? 'Unassigned'}`
                                      : `Round ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`,
                                  ),
                                ),
                              ).map((title) => ({
                                title,
                                matches: phaseMatches.filter(
                                  (m) =>
                                    (competitionMatchGrouping === 'group'
                                      ? `Group ${m.group_number ?? 'Unassigned'}`
                                      : `Round ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`) ===
                                    title,
                                ),
                              }))
                            : isKnockout
                              ? Array.from(
                                  new Set(
                                    phaseMatches.map((m) =>
                                      knockoutStageLabel(m.round_number, stageCount),
                                    ),
                                  ),
                                ).map((title) => ({
                                  title,
                                  matches: phaseMatches.filter(
                                    (m) => knockoutStageLabel(m.round_number, stageCount) === title,
                                  ),
                                }))
                              : [{ title: '', matches: phaseMatches }];
                          return (
                            <div className="mt-2 space-y-4">
                              {grouped.map((group) => (
                                <section key={group.title || phase} className="space-y-2">
                                  {!leagueTournament && group.title && (
                                    <h5 className="text-sm font-semibold text-muted-foreground">
                                      {group.title}
                                    </h5>
                                  )}
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                    {group.matches.map((m) => (
                                      <article
                                        key={m.id}
                                        className={`rounded-lg border border-border p-3 ${isOwnPair(m.pair_one_id) || isOwnPair(m.pair_two_id) || (format === 'team' && (ownTeamIds.includes(m.team_one_id || '') || ownTeamIds.includes(m.team_two_id || ''))) ? 'border-primary/40 bg-primary/[0.04]' : ''}`}
                                      >
                                        <div
                                          className="grid items-center gap-x-2 gap-y-1"
                                          style={{
                                            gridTemplateColumns: (m.score_sets ?? []).length
                                              ? `repeat(${m.score_sets.length}, 2.25rem) minmax(0,1fr)`
                                              : 'minmax(0,1fr)',
                                          }}
                                        >
                                          {(m.score_sets ?? []).map((set, index) => (
                                            <span
                                              key={`one-${index}`}
                                              className={`rounded border border-border px-1 py-1 text-center text-[15px] font-mono tabular-nums ${set.one > set.two ? 'font-bold' : ''}`}
                                            >
                                              {set.one}
                                            </span>
                                          ))}
                                          <div
                                            className={`min-w-0 truncate ${m.winner_side === 1 ? 'font-semibold' : ''}`}
                                          >
                                            {m.phase.includes('knockout')
                                              ? bracketSideLabel(
                                                  m,
                                                  1,
                                                  Math.max(
                                                    1,
                                                    ...categoryVisibleMatches
                                                      .filter((item) => item.phase === m.phase)
                                                      .map((item) => item.round_number),
                                                  ),
                                                )
                                              : format === 'team'
                                                ? m.team_one_name || 'TBD'
                                                : m.player_one_name || 'TBD'}
                                            {(format === 'team'
                                              ? ownTeamIds.includes(m.team_one_id || '')
                                              : isOwnPair(m.pair_one_id)) && (
                                              <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                                                You
                                              </span>
                                            )}
                                          </div>
                                          {(m.score_sets ?? []).map((set, index) => (
                                            <span
                                              key={`two-${index}`}
                                              className={`rounded border border-border px-1 py-1 text-center text-[15px] font-mono tabular-nums ${set.two > set.one ? 'font-bold' : ''}`}
                                            >
                                              {set.two}
                                            </span>
                                          ))}
                                          <div
                                            className={`min-w-0 truncate ${m.winner_side === 2 ? 'font-semibold' : ''}`}
                                          >
                                            {m.phase.includes('knockout')
                                              ? bracketSideLabel(
                                                  m,
                                                  2,
                                                  Math.max(
                                                    1,
                                                    ...categoryVisibleMatches
                                                      .filter((item) => item.phase === m.phase)
                                                      .map((item) => item.round_number),
                                                  ),
                                                )
                                              : format === 'team'
                                                ? m.team_two_name || 'TBD'
                                                : m.opponent_one_name || 'TBD'}
                                            {(format === 'team'
                                              ? ownTeamIds.includes(m.team_two_id || '')
                                              : isOwnPair(m.pair_two_id)) && (
                                              <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                                                You
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <p className="mt-2 text-xs text-muted-foreground">
                                          {[
                                            m.group_number ? `Group ${m.group_number}` : null,
                                            m.phase.includes('knockout')
                                              ? `${knockoutStageLabel(m.round_number, Math.max(1, ...categoryVisibleMatches.filter((item) => item.phase === m.phase).map((item) => item.round_number)))} ${m.match_number}`
                                              : `${leagueTournament ? 'Sub-session' : 'Round'} ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`,
                                            m.status === 'bye' ? null : dateLabel(m.scheduled_at),
                                            m.status !== 'bye' &&
                                            m.scheduled_at &&
                                            !leagueTournament
                                              ? `Ends ${formatTime(new Date(new Date(m.scheduled_at).getTime() + Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000))}`
                                              : null,
                                            m.court_number ? `Court ${m.court_number}` : null,
                                          ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                        </p>
                                        {!(m.score_sets ?? []).length && (
                                          <p className="mt-1 text-xs text-muted-foreground">
                                            {m.status === 'bye'
                                              ? 'Walkover — winner advances'
                                              : m.status === 'completed'
                                                ? 'Walkover / result recorded'
                                                : 'Upcoming'}
                                          </p>
                                        )}
                                        {format === 'team' && m.status === 'completed' && (
                                          <p className="mt-2 text-xs text-muted-foreground">
                                            Team standings points: {m.team_points_one} –{' '}
                                            {m.team_points_two}
                                          </p>
                                        )}
                                        {format === 'team' &&
                                          currentUserId &&
                                          ([1, 2] as const)
                                            .filter(
                                              (side) =>
                                                m.status !== 'completed' &&
                                                m.status !== 'cancelled' &&
                                                (() => {
                                                  const teamId =
                                                    side === 1 ? m.team_one_id : m.team_two_id;
                                                  return (
                                                    !!teamId &&
                                                    teams.some(
                                                      (team) =>
                                                        team.id === teamId &&
                                                        team.captain_user_id === currentUserId,
                                                    )
                                                  );
                                                })(),
                                            )
                                            .map((side) => {
                                              const teamId = (
                                                side === 1 ? m.team_one_id : m.team_two_id
                                              )!;
                                              const currentSidePlayers = matchPlayers.filter(
                                                (p) => p.match_id === m.id && p.team_id === teamId,
                                              );
                                              const roster = participants.filter(
                                                (p) => p.team_id === teamId,
                                              );
                                              return (
                                                <div
                                                  key={`${m.id}-pairing-${side}`}
                                                  className="mt-3 rounded-md bg-secondary/30 p-3"
                                                >
                                                  <p className="text-sm font-medium">
                                                    Your team pairing (
                                                    {side === 1 ? 'Side one' : 'Side two'})
                                                  </p>
                                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                                    <label className="text-xs">
                                                      Player one
                                                      <select
                                                        id={`captain-pair-${m.id}-${side}-a`}
                                                        className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                                        defaultValue={
                                                          currentSidePlayers[0]?.participant_id ??
                                                          ''
                                                        }
                                                      >
                                                        <option value="">Select player</option>
                                                        {roster.map((p) => (
                                                          <option key={p.id} value={p.id}>
                                                            {p.display_name}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </label>
                                                    <label className="text-xs">
                                                      Player two
                                                      <select
                                                        id={`captain-pair-${m.id}-${side}-b`}
                                                        className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                                        defaultValue={
                                                          currentSidePlayers[1]?.participant_id ??
                                                          ''
                                                        }
                                                      >
                                                        <option value="">Select player</option>
                                                        {roster
                                                          .filter(
                                                            (p) =>
                                                              p.id !==
                                                              currentSidePlayers[0]?.participant_id,
                                                          )
                                                          .map((p) => (
                                                            <option key={p.id} value={p.id}>
                                                              {p.display_name}
                                                            </option>
                                                          ))}
                                                      </select>
                                                    </label>
                                                  </div>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      void saveCaptainPairing(m, teamId, side)
                                                    }
                                                    className="mt-2 h-8 rounded-md border border-border px-3 text-sm"
                                                  >
                                                    Save pairing
                                                  </button>
                                                </div>
                                              );
                                            })}
                                        {format === 'team' &&
                                          currentUserId &&
                                          teams.some(
                                            (team) =>
                                              team.captain_user_id === currentUserId &&
                                              (team.id === m.team_one_id ||
                                                team.id === m.team_two_id),
                                          ) && (
                                            <div className="mt-3 flex flex-wrap items-end gap-2">
                                              <label className="text-xs">
                                                Edit result (sets)
                                                <input
                                                  id={`captain-score-${m.id}`}
                                                  defaultValue={(m.score_sets ?? [])
                                                    .map((set) => `${set.one}-${set.two}`)
                                                    .join(', ')}
                                                  placeholder="6-4, 3-6, 10-8"
                                                  className="mt-1 block h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
                                                />
                                              </label>
                                              <button
                                                type="button"
                                                onClick={() => void saveCaptainScore(m)}
                                                className="h-9 rounded-md border border-border px-3 text-sm"
                                              >
                                                Save result
                                              </button>
                                            </div>
                                          )}
                                      </article>
                                    ))}
                                  </div>
                                </section>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                </div>
              ))}
          </details>
        ))}
    </div>
  );
}
