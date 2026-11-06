import { useState, type FormEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';
import { TournamentCourtScheduleBoard } from '@/components/tournament-court-schedule-board';
import { TournamentMatchScheduleControls } from '@/components/tournament-match-schedule-controls';
import { hasSingleTournamentGroup } from '@/lib/tournament-groups';
import { DraggableItem } from '@/components/drag-drop';
import { knockoutStageLabel, type TournamentConfig } from '@/lib/tournament-config';
import { getTournamentScoringTemplate } from '@/lib/tournament-config';
import { teamMatchPoints } from '@/lib/tournament-score';
import {
  normalizeTournamentGender,
  teamMatchGenderIneligibilityReason,
} from '@/lib/tournament-config';
import type {
  Match,
  MatchPlayer,
  Pair,
  Participant,
  Team,
} from '@/components/tournament-management-types';

type ScheduleConflict = {
  court: number;
  previous: Match;
  current: Match;
  severity: 'danger' | 'warning';
};
type MatchTileLabels = { players: string; stage: string };
type MatchOption = readonly [string, string];
export type Props = {
  isTeam: boolean;
  captainMode?: boolean;
  captainTeamId?: string | null;
  busy: boolean;
  config: TournamentConfig | null;
  courtCount: number;
  activeParticipants: Participant[];
  adminMatchList: Match[];
  adminRoundByMatch: Map<string, number>;
  availableMatchPhases: readonly MatchOption[];
  bracketNeedsRedraw: boolean;
  knockoutBracketHasResults: boolean;
  isRoundRobinPhase: boolean;
  matchCategory: string;
  matchPhase: string;
  matchGrouping: 'group' | 'round';
  matchOne: string;
  matchTwo: string;
  matchTime: string;
  matchCourt: string;
  teamPairSelection: Record<string, { first: string; second: string }>;
  matchPlayers: MatchPlayer[];
  matches: Match[];
  pairs: Pair[];
  teams: Team[];
  courtScheduleConflicts: ScheduleConflict[];
  formatDateTime: (value: string) => string;
  formatTime: (value: Date | string | number) => string;
  localDateTime: (value: string | null) => string;
  matchCourtTileNames: (match: Match) => MatchTileLabels;
  matchSideOptions: (match: Match, side: 1 | 2) => MemberOption[];
  matchSideValue: (match: Match, side: 1 | 2) => string;
  newMatchSideOptions: (side: 1 | 2) => MemberOption[];
  createMatch: (event: FormEvent) => void;
  changeMatchSide: (match: Match, side: 1 | 2, newId: string) => void;
  deleteMatch: (match: Match) => void;
  moveMatchToCourt: (match: Match, court: number | null) => void;
  generateSchedule: () => void;
  randomizeKnockoutDraw: () => void;
  recordWalkover: (match: Match, winner: 1 | 2) => void;
  saveScore: (match: Match, raw: string) => void;
  saveMatch: (match: Match, changes: Partial<Match>) => Promise<boolean>;
  saveTeamPairing: (match: Match, teamId: string, side: 1 | 2, visibleToPublic: boolean) => void;
  saveCaptainPairing?: (
    match: Match,
    teamId: string,
    side: 1 | 2,
    first: string,
    second: string,
    visibleToPublic: boolean,
  ) => void;
  setMatchCourt: (value: string) => void;
  setMatchGrouping: (value: 'group' | 'round') => void;
  setMatchOne: (value: string) => void;
  setMatchPhase: (value: string) => void;
  setMatchTime: (value: string) => void;
  setMatchTwo: (value: string) => void;
  setTeamPairSelection: (
    value: (
      previous: Record<string, { first: string; second: string }>,
    ) => Record<string, { first: string; second: string }>,
  ) => void;
};

export function TournamentMatchManagementPanel(props: Props) {
  const {
    isTeam,
    captainMode = false,
    captainTeamId = null,
    busy,
    config,
    courtCount,
    activeParticipants,
    adminMatchList,
    adminRoundByMatch,
    isRoundRobinPhase,
    matchPhase,
    matchGrouping,
    teamPairSelection,
    matchPlayers,
    matches,
    pairs,
    teams,
    courtScheduleConflicts,
    formatDateTime,
    formatTime,
    localDateTime,
    matchCourtTileNames,
    matchSideOptions,
    matchSideValue,
    changeMatchSide,
    deleteMatch,
    moveMatchToCourt,
    recordWalkover,
    saveScore,
    saveMatch,
    saveTeamPairing,
    saveCaptainPairing,
    setTeamPairSelection,
  } = props;
  const [lineupVisibility, setLineupVisibility] = useState<Record<string, boolean>>({});
  const singleGroup = hasSingleTournamentGroup(config);
  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <TournamentMatchScheduleControls {...props} singleGroup={singleGroup} />
      <div className="space-y-3">
        {!captainMode && (
          <TournamentCourtScheduleBoard
            courtCount={courtCount}
            matches={matches}
            getMatchLabels={matchCourtTileNames}
            formatScheduledTime={formatDateTime}
            conflicts={courtScheduleConflicts.map((conflict) => ({
              key: `${conflict.court}-${conflict.current.id}`,
              court: conflict.court,
              severity: conflict.severity,
              previousPlayers: matchCourtTileNames(conflict.previous).players,
              previousTime: formatDateTime(conflict.previous.scheduled_at!),
              currentPlayers: matchCourtTileNames(conflict.current).players,
              currentTime: formatDateTime(conflict.current.scheduled_at!),
            }))}
            onMoveMatchToCourt={(matchId, court) => {
              const match = matches.find((item) => item.id === matchId);
              if (match) void moveMatchToCourt(match, court);
            }}
          />
        )}
        {adminMatchList.map((m, index, list) => {
          const knockoutPhase = matchPhase.includes('knockout');
          const groupKey = knockoutPhase
            ? String(m.round_number)
            : matchGrouping === 'group'
              ? String(m.group_number ?? 'unassigned')
              : String(adminRoundByMatch.get(m.id) ?? m.round_number);
          const previous = index > 0 ? list[index - 1] : null;
          const previousKey = previous
            ? knockoutPhase
              ? String(previous.round_number)
              : matchGrouping === 'group'
                ? String(previous.group_number ?? 'unassigned')
                : String(adminRoundByMatch.get(previous.id) ?? previous.round_number)
            : null;
          const showGroupTitle =
            !captainMode &&
            (isRoundRobinPhase || knockoutPhase) &&
            !(singleGroup && isRoundRobinPhase) &&
            (index === 0 || groupKey !== previousKey);
          const maxStageRound = Math.max(1, ...list.map((item) => item.round_number));
          const groupTitle = knockoutPhase
            ? knockoutStageLabel(m.round_number, maxStageRound)
            : matchGrouping === 'group'
              ? singleGroup
                ? ''
                : m.group_number
                  ? `Group ${m.group_number}`
                  : 'Unassigned group'
              : `Round ${adminRoundByMatch.get(m.id) ?? m.round_number}`;
          const sideName = (side: 1 | 2): string => {
            const id = isTeam
              ? side === 1
                ? m.team_one_id
                : m.team_two_id
              : side === 1
                ? m.pair_one_id
                : m.pair_two_id;
            if (id) {
              if (isTeam) return teams.find((team) => team.id === id)?.name || 'TBD';
              const pair = pairs.find((item) => item.id === id);
              if (pair) return `${pair.player_one_name} + ${pair.player_two_name}`;
            }
            const phaseMatches = matches.filter(
              (item) => item.category === m.category && item.phase === m.phase,
            );
            const maxRound = Math.max(1, ...phaseMatches.map((item) => item.round_number));
            if (m.round_number > 1) {
              const previousRound = m.round_number - 1;
              const previousMatchNumber = (m.match_number - 1) * 2 + side;
              const previous = phaseMatches.find(
                (item) =>
                  item.round_number === previousRound && item.match_number === previousMatchNumber,
              );
              if (previous?.winner_side) {
                const winnerId = isTeam
                  ? previous.winner_side === 1
                    ? previous.team_one_id
                    : previous.team_two_id
                  : previous.winner_side === 1
                    ? previous.pair_one_id
                    : previous.pair_two_id;
                if (winnerId)
                  return isTeam
                    ? teams.find((team) => team.id === winnerId)?.name ||
                        `Winner of ${knockoutStageLabel(previousRound, maxRound)} ${previousMatchNumber}`
                    : (() => {
                        const pair = pairs.find((item) => item.id === winnerId);
                        return pair
                          ? `${pair.player_one_name} + ${pair.player_two_name}`
                          : `Winner of ${knockoutStageLabel(previousRound, maxRound)} ${previousMatchNumber}`;
                      })();
              }
              return `Winner of ${knockoutStageLabel(previousRound, maxRound)} ${previousMatchNumber}`;
            }
            try {
              const notes = JSON.parse(m.notes || '{}') as {
                slot_one?: string | null;
                slot_two?: string | null;
              };
              return (side === 1 ? notes.slot_one : notes.slot_two) || 'TBD';
            } catch {
              return 'TBD';
            }
          };
          const scoreText = (m.score_sets ?? []).map((set) => `${set.one}-${set.two}`).join(', ');
          return (
            <div key={m.id} className="space-y-2">
              {showGroupTitle && (
                <h4 className="pt-2 text-sm font-semibold text-muted-foreground">{groupTitle}</h4>
              )}
              <DraggableItem
                id={m.id}
                dataType="application/x-pctc-match-id"
                draggable={!captainMode}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {sideName(1)} vs {sideName(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        const phaseMatches = matches.filter(
                          (item) => item.category === m.category && item.phase === m.phase,
                        );
                        const maxRound = Math.max(
                          1,
                          ...phaseMatches.map((item) => item.round_number),
                        );
                        if (m.phase.includes('round_robin'))
                          return `Match ${m.match_number} · ${m.status === 'bye' ? 'BYE — automatic advancement' : m.status}`;
                        const stage = knockoutStageLabel(m.round_number, maxRound);
                        return `${stage} ${m.match_number} · ${m.status === 'bye' ? 'BYE — automatic advancement' : m.status}`;
                      })()}
                    </p>
                  </div>
                  {!captainMode && (
                    <details className="relative shrink-0" data-tournament-menu="true">
                      <summary
                        aria-label={`Actions for match ${m.match_number}`}
                        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-input hover:bg-secondary [&::-webkit-details-marker]:hidden"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </summary>
                      <div className="absolute right-0 z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] flex flex-col rounded-md border border-border bg-background p-1 shadow-lg">
                        <button
                          type="button"
                          className="rounded px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
                          disabled={busy}
                          onClick={() => void deleteMatch(m)}
                        >
                          Delete match
                        </button>
                        <button
                          type="button"
                          className="rounded px-3 py-2 text-left text-sm hover:bg-secondary"
                          disabled={busy || !(m.pair_one_id || m.team_one_id)}
                          onClick={() => void recordWalkover(m, 1)}
                        >
                          Walkover: side one
                        </button>
                        <button
                          type="button"
                          className="rounded px-3 py-2 text-left text-sm hover:bg-secondary"
                          disabled={busy || !(m.pair_two_id || m.team_two_id)}
                          onClick={() => void recordWalkover(m, 2)}
                        >
                          Walkover: side two
                        </button>
                      </div>
                    </details>
                  )}
                </div>
                {m.status === 'bye' && (
                  <div
                    role="status"
                    className="rounded-md border-2 border-warning bg-warning/10 px-4 py-3 text-sm"
                  >
                    <p className="font-bold tracking-wide">BYE — AUTOMATIC ADVANCEMENT</p>
                    <p className="mt-1">
                      This is not a played match. Score entry is disabled; the opposing side
                      advances automatically.
                    </p>
                  </div>
                )}
                {!captainMode && m.status !== 'completed' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs">
                      Side one draw
                      <SearchableMemberSelect
                        value={matchSideValue(m, 1)}
                        onChange={(value) => void changeMatchSide(m, 1, value)}
                        placeholder="Choose side one or a group slot"
                        options={matchSideOptions(m, 1)}
                      />
                    </label>
                    <label className="block text-xs">
                      Side two draw
                      <SearchableMemberSelect
                        value={matchSideValue(m, 2)}
                        onChange={(value) => void changeMatchSide(m, 2, value)}
                        placeholder="Choose side two or a group slot"
                        options={matchSideOptions(m, 2)}
                      />
                    </label>
                  </div>
                )}
                {captainMode ? (
                  <p className="text-xs text-muted-foreground">
                    {m.scheduled_at ? formatDateTime(m.scheduled_at) : 'Date not scheduled'}
                    {m.court_number ? ` · Court ${m.court_number}` : ' · Court not assigned'}
                  </p>
                ) : (
                  <div className="grid items-start gap-3 sm:grid-cols-3">
                    <label className="flex min-w-0 flex-col gap-1 text-xs">
                      Date/time
                      <Input
                        className="h-10"
                        type="datetime-local"
                        value={localDateTime(m.scheduled_at)}
                        onChange={(e) =>
                          void saveMatch(m, {
                            scheduled_at: e.target.value
                              ? new Date(e.target.value).toISOString()
                              : null,
                          })
                        }
                      />
                      {m.scheduled_at && (
                        <span className="text-muted-foreground">
                          Scheduled end:{' '}
                          {formatTime(
                            new Date(
                              new Date(m.scheduled_at).getTime() +
                                Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000,
                            ),
                          )}
                        </span>
                      )}
                    </label>
                    <label className="flex min-w-0 flex-col gap-1 text-xs">
                      Court
                      <select
                        className="block h-10 w-full rounded-md border border-input bg-background px-3"
                        value={m.court_number ?? ''}
                        onChange={(e) =>
                          void moveMatchToCourt(m, e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">Unassigned</option>
                        {Array.from({ length: Math.max(1, courtCount) }, (_, i) => i + 1).map(
                          (n) => (
                            <option key={n} value={n}>
                              Court {n}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1 text-xs">
                      Set scores (e.g. 6-4, 3-6, 10-8)
                      <Input
                        className="h-10"
                        key={`${m.id}-${scoreText}`}
                        defaultValue={scoreText}
                        placeholder={m.status === 'bye' ? 'Unavailable for BYE' : '6-4, 6-3'}
                        disabled={m.status === 'bye'}
                        onBlur={(e) => {
                          if (e.target.value !== scoreText) void saveScore(m, e.target.value);
                        }}
                      />
                    </label>
                  </div>
                )}
                {isTeam && m.status !== 'completed' && m.status !== 'cancelled' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([1, 2] as const)
                      .filter(
                        (side) =>
                          !captainMode ||
                          (side === 1 ? m.team_one_id : m.team_two_id) === captainTeamId,
                      )
                      .map((side) => {
                        const teamId = side === 1 ? m.team_one_id : m.team_two_id;
                        if (!teamId) return null;
                        const roster = activeParticipants.filter(
                          (participant) =>
                            participant.team_id === teamId && participant.category === 'team',
                        );
                        const currentPair = matchPlayers.filter(
                          (player) => player.match_id === m.id && player.team_id === teamId,
                        );
                        const firstId =
                          teamPairSelection[`${m.id}-${side}`]?.first ??
                          currentPair[0]?.participant_id ??
                          '';
                        const firstParticipant = roster.find(
                          (participant) => participant.id === firstId,
                        );
                        const firstGender = normalizeTournamentGender(
                          firstParticipant?.gender_override ?? firstParticipant?.gender,
                        );
                        const visibilityKey = `${m.id}-${side}`;
                        const visibleToPublic =
                          lineupVisibility[visibilityKey] ??
                          (side === 1
                            ? m.team_one_lineup_public === true
                            : m.team_two_lineup_public === true);
                        return (
                          <div
                            key={`${m.id}-team-pair-${side}`}
                            className="rounded-md bg-secondary/30 p-3"
                          >
                            <p className="text-xs font-semibold">{sideName(side)} lineup</p>
                            <div className="mt-2 grid gap-2">
                              <SearchableMemberSelect
                                value={
                                  teamPairSelection[`${m.id}-${side}`]?.first ??
                                  currentPair[0]?.participant_id ??
                                  ''
                                }
                                onChange={(value) =>
                                  setTeamPairSelection((previous) => ({
                                    ...previous,
                                    [`${m.id}-${side}`]: {
                                      first: value,
                                      second:
                                        previous[`${m.id}-${side}`]?.second ??
                                        currentPair[1]?.participant_id ??
                                        '',
                                    },
                                  }))
                                }
                                placeholder="Choose player one"
                                options={roster.map((participant): MemberOption => {
                                  const reason = teamMatchGenderIneligibilityReason(
                                    m.category,
                                    participant.gender_override ?? participant.gender,
                                  );
                                  return {
                                    id: participant.id,
                                    full_name: participant.display_name,
                                    statusText: reason || 'Team roster member',
                                    available: !reason,
                                    unavailableReason: reason || undefined,
                                  };
                                })}
                              />
                              <SearchableMemberSelect
                                value={
                                  teamPairSelection[`${m.id}-${side}`]?.second ??
                                  currentPair[1]?.participant_id ??
                                  ''
                                }
                                onChange={(value) =>
                                  setTeamPairSelection((previous) => ({
                                    ...previous,
                                    [`${m.id}-${side}`]: {
                                      first:
                                        previous[`${m.id}-${side}`]?.first ??
                                        currentPair[0]?.participant_id ??
                                        '',
                                      second: value,
                                    },
                                  }))
                                }
                                placeholder="Choose player two"
                                options={roster.map((participant): MemberOption => {
                                  const sameMixedGender =
                                    m.category === 'mixed' &&
                                    firstGender !== null &&
                                    normalizeTournamentGender(
                                      participant.gender_override ?? participant.gender,
                                    ) === firstGender;
                                  let reason: string | null = null;
                                  if (participant.id === firstId) {
                                    reason = 'Already selected as player one';
                                  } else {
                                    reason = teamMatchGenderIneligibilityReason(
                                      m.category,
                                      participant.gender_override ?? participant.gender,
                                    );
                                    if (!reason && m.category === 'mixed' && firstGender === null)
                                      reason = 'Select a player with a known gender first';
                                    if (!reason && sameMixedGender)
                                      reason =
                                        'Mixed matches require one male and one female player';
                                  }
                                  return {
                                    id: participant.id,
                                    full_name: participant.display_name,
                                    statusText: reason || 'Team roster member',
                                    available: !reason,
                                    unavailableReason: reason || undefined,
                                  };
                                })}
                              />
                              <label className="flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={visibleToPublic}
                                  onChange={(event) =>
                                    setLineupVisibility((current) => ({
                                      ...current,
                                      [visibilityKey]: event.target.checked,
                                    }))
                                  }
                                />
                                Show this lineup to everyone on the public tournament page
                              </label>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  captainMode
                                    ? saveCaptainPairing?.(
                                        m,
                                        teamId,
                                        side,
                                        teamPairSelection[`${m.id}-${side}`]?.first ??
                                          currentPair[0]?.participant_id ??
                                          '',
                                        teamPairSelection[`${m.id}-${side}`]?.second ??
                                          currentPair[1]?.participant_id ??
                                          '',
                                        visibleToPublic,
                                      )
                                    : saveTeamPairing(m, teamId, side, visibleToPublic)
                                }
                              >
                                Save lineup
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
                {captainMode &&
                  isTeam &&
                  (() => {
                    const opponentTeamId =
                      m.team_one_id === captainTeamId ? m.team_two_id : m.team_one_id;
                    const opponentSide = m.team_one_id === opponentTeamId ? 1 : 2;
                    const opponentVisible =
                      opponentSide === 1 ? m.team_one_lineup_public : m.team_two_lineup_public;
                    if (!opponentVisible || !opponentTeamId) return null;
                    const names = opponentSide === 1 ? m.player_one_name : m.opponent_one_name;
                    return names ? (
                      <p className="text-xs text-muted-foreground">Opponent lineup: {names}</p>
                    ) : null;
                  })()}
                {isTeam &&
                  m.status === 'completed' &&
                  getTournamentScoringTemplate(config, m.phase) === 'team_two_sets_bonus_third' && (
                    <p className="text-xs text-muted-foreground">
                      Team standings points:{' '}
                      {
                        teamMatchPoints(
                          m.score_sets ?? [],
                          getTournamentScoringTemplate(config, m.phase),
                        ).pointsOne
                      }
                      {' – '}
                      {
                        teamMatchPoints(
                          m.score_sets ?? [],
                          getTournamentScoringTemplate(config, m.phase),
                        ).pointsTwo
                      }
                      .
                    </p>
                  )}
                {m.notes &&
                  (() => {
                    try {
                      const parsed = JSON.parse(m.notes) as Record<string, unknown>;
                      if (
                        parsed &&
                        typeof parsed === 'object' &&
                        ('slot_one' in parsed || 'slot_two' in parsed)
                      )
                        return null;
                    } catch {
                      // Non-JSON notes are normal user-facing notes and should remain visible.
                    }
                    const isWalkoverNote =
                      /^Walkover \/ retirement awarded to side (one|two)$/i.test(m.notes.trim());
                    return isWalkoverNote ? (
                      <div
                        role="status"
                        className="mt-2 rounded-md border border-warning/60 bg-warning/15 px-3 py-2 text-sm font-semibold text-warning-foreground dark:bg-warning/40 dark:text-warning-foreground"
                      >
                        {m.notes}
                      </div>
                    ) : (
                      <p className="text-sm">{m.notes}</p>
                    );
                  })()}
              </DraggableItem>
            </div>
          );
        })}
        {!adminMatchList.length && (
          <p className="text-sm text-muted-foreground">No matches created yet.</p>
        )}
      </div>
    </div>
  );
}
