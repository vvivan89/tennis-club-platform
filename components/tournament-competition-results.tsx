import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { TournamentConfig } from '@/lib/tournament-config';
import {
  knockoutStageLabel,
  normalizeTournamentGender,
  teamMatchGenderIneligibilityReason,
} from '@/lib/tournament-config';
import { compareByScheduleThenCourt } from '@/lib/tournament-match';
import { formatTime } from '@/lib/time-format';
import { LeagueEventStandings } from '@/components/league-event-standings';
import { TournamentPublicGroupStandingsPanel } from '@/components/tournament-public-group-standings-panel';
import { UserIdentity } from '@/components/user-identity';
import { hasSingleTournamentGroup } from '@/lib/tournament-groups';
import { categoryLabel } from '@/components/tournament-public-view-format';
import { aggregateOverallTeamStandings } from '@/components/tournament-public-group-standings';
import { getTournamentScoringTemplate } from '@/lib/tournament-config';
import { teamMatchPoints } from '@/lib/tournament-score';
import { TournamentKnockoutBracket } from '@/components/tournament-knockout-bracket';
import { TournamentMatchSide } from '@/components/tournament-match-side';
import type {
  GroupOverride,
  Match,
  Pair,
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
  eventStartsAt: string;
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
  showCaptainLineupEditor?: boolean;
  openGroupOverrideEditor: (group: GroupStanding) => void;
  resultsOnly: boolean;
  competitionMatchGrouping: 'group' | 'round';
  setCompetitionMatchGrouping: (mode: 'group' | 'round') => void;
  participants: Participant[];
  pairs: Pair[];
  teams: Team[];
  currentUserId: string | null;
  matchPlayers: Array<{
    match_id: string;
    participant_id: string;
    side: number;
    team_id: string | null;
  }>;
  saveCaptainPairing: (match: Match, teamId: string, side: 1 | 2) => void;
  saveCaptainScore: (match: Match, score?: string) => Promise<boolean>;
  isOwnPair: (pairId: string | null | undefined) => boolean;
  ownTeamIds: string[];
  roundRobinRoundByMatch: Map<string, number>;
};

export function TournamentCompetitionResults({
  leagueTournament,
  leagueStandingsBefore,
  leagueStandingsAfter,
  leagueHasResults,
  eventStartsAt,
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
  showCaptainLineupEditor = false,
  openGroupOverrideEditor,
  resultsOnly,
  competitionMatchGrouping,
  setCompetitionMatchGrouping,
  participants,
  pairs,
  teams,
  currentUserId,
  matchPlayers,
  saveCaptainPairing,
  saveCaptainScore,
  isOwnPair,
  ownTeamIds,
  roundRobinRoundByMatch,
}: Props) {
  const singleGroup = hasSingleTournamentGroup(config);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [captainLineups, setCaptainLineups] = useState<
    Record<string, { first: string; second: string }>
  >({});
  const [editingCaptainMatch, setEditingCaptainMatch] = useState<Match | null>(null);
  const [captainScoreDraft, setCaptainScoreDraft] = useState('');
  const [captainScoreSaving, setCaptainScoreSaving] = useState(false);
  const submitCaptainScore = async () => {
    if (!editingCaptainMatch) return;
    setCaptainScoreSaving(true);
    await saveCaptainScore(editingCaptainMatch, captainScoreDraft);
    setCaptainScoreSaving(false);
    setEditingCaptainMatch(null);
  };
  const displayGroupStandings =
    format === 'team' && activeCategory === 'overall'
      ? aggregateOverallTeamStandings(groupStandings, config, categoryVisibleMatches)
      : groupStandings;
  const matchGrouping = singleGroup ? 'round' : competitionMatchGrouping;
  const renderPair = (pair: Pair | undefined) => {
    if (!pair) return null;
    const one = participants.find((p) => p.id === pair.player_one_id);
    const two = participants.find((p) => p.id === pair.player_two_id);
    const identity = (p: Participant | undefined, name: string, skill?: number | null) => (
      <UserIdentity
        name={p?.display_name ?? name}
        skillLevel={p?.tennis_skill_level ?? skill}
        avatarUrl={p?.avatar_url}
        birthdayVisible={p?.birthday_emoji_visible}
        compact
      />
    );
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {identity(one, pair.player_one_name, pair.player_one_skill_level)} +{' '}
        {identity(two, pair.player_two_name, pair.player_two_skill_level)}
      </span>
    );
  };
  const pairSide = (match: Match, side: 1 | 2) =>
    renderPair(
      pairs.find((pair) => pair.id === (side === 1 ? match.pair_one_id : match.pair_two_id)),
    );
  return (
    <div className="space-y-6">
      {leagueTournament && (
        <LeagueEventStandings
          before={leagueStandingsBefore}
          after={leagueStandingsAfter}
          hasResults={leagueHasResults}
          currentUserId={currentUserId}
          participants={participants}
        />
      )}
      <TournamentKnockoutBracket
        knockoutMatches={knockoutMatches}
        bracketStageLabel={bracketStageLabel}
        bracketSideLabel={bracketSideLabel}
        format={format}
        pairSide={pairSide}
      />

      {!leagueTournament && (
        <TournamentPublicGroupStandingsPanel
          groupStandings={displayGroupStandings}
          teams={teams}
          pairs={pairs}
          participants={participants}
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
      )}
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
              !singleGroup &&
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
            {([activeCategory] as const)
              .filter(
                (category) =>
                  categoryVisibleMatches.some((m) => m.category === category) ||
                  category === 'overall',
              )
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
                        (m) =>
                          (category === 'overall' || m.category === category) && m.phase === phase,
                      ),
                    )
                    .map((phase) => (
                      <div key={phase}>
                        {!leagueTournament && <h4 className="font-medium">{phaseLabel(phase)}</h4>}
                        {(() => {
                          const phaseMatches = categoryVisibleMatches
                            .filter(
                              (m) =>
                                (category === 'overall' || m.category === category) &&
                                m.phase === phase,
                            )
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
                                    matchGrouping === 'group'
                                      ? `Group ${m.group_number ?? 'Unassigned'}`
                                      : `Round ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`,
                                  ),
                                ),
                              ).map((title) => ({
                                title,
                                matches: phaseMatches.filter(
                                  (m) =>
                                    (matchGrouping === 'group'
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
                                          <TournamentMatchSide
                                            winner={m.winner_side === 1}
                                            logoUrl={
                                              format === 'team'
                                                ? teams.find((team) => team.id === m.team_one_id)
                                                    ?.logo_url
                                                : null
                                            }
                                            name={
                                              m.phase.includes('knockout')
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
                                                  : pairSide(m, 1) || m.player_one_name || 'TBD'
                                            }
                                            playerName={
                                              format === 'team' ? m.player_one_name : null
                                            }
                                            isOwn={
                                              format === 'team'
                                                ? ownTeamIds.includes(m.team_one_id || '')
                                                : isOwnPair(m.pair_one_id)
                                            }
                                          />
                                          {(m.score_sets ?? []).map((set, index) => (
                                            <span
                                              key={`two-${index}`}
                                              className={`rounded border border-border px-1 py-1 text-center text-[15px] font-mono tabular-nums ${set.two > set.one ? 'font-bold' : ''}`}
                                            >
                                              {set.two}
                                            </span>
                                          ))}
                                          <TournamentMatchSide
                                            winner={m.winner_side === 2}
                                            logoUrl={
                                              format === 'team'
                                                ? teams.find((team) => team.id === m.team_two_id)
                                                    ?.logo_url
                                                : null
                                            }
                                            name={
                                              m.phase.includes('knockout')
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
                                                  : pairSide(m, 2) || m.opponent_one_name || 'TBD'
                                            }
                                            playerName={
                                              format === 'team' ? m.opponent_one_name : null
                                            }
                                            isOwn={
                                              format === 'team'
                                                ? ownTeamIds.includes(m.team_two_id || '')
                                                : isOwnPair(m.pair_two_id)
                                            }
                                          />
                                        </div>
                                        <p className="mt-2 text-xs text-muted-foreground">
                                          {[
                                            m.group_number && !singleGroup
                                              ? `Group ${m.group_number}`
                                              : null,
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
                                            format === 'team' && activeCategory === 'overall'
                                              ? categoryLabel(m.category)
                                              : null,
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
                                        {format === 'team' &&
                                          m.status === 'completed' &&
                                          getTournamentScoringTemplate(config, m.phase) ===
                                            'team_two_sets_bonus_third' && (
                                            <p className="mt-2 text-xs text-muted-foreground">
                                              Team standings points:{' '}
                                              {
                                                teamMatchPoints(
                                                  m.score_sets ?? [],
                                                  getTournamentScoringTemplate(config, m.phase),
                                                ).pointsOne
                                              }{' '}
                                              –{' '}
                                              {
                                                teamMatchPoints(
                                                  m.score_sets ?? [],
                                                  getTournamentScoringTemplate(config, m.phase),
                                                ).pointsTwo
                                              }
                                            </p>
                                          )}
                                        {showCaptainLineupEditor &&
                                          format === 'team' &&
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
                                              const lineupKey = `${m.id}-${side}`;
                                              const firstPlayerId =
                                                captainLineups[lineupKey]?.first ??
                                                currentSidePlayers[0]?.participant_id ??
                                                '';
                                              const secondPlayerId =
                                                captainLineups[lineupKey]?.second ??
                                                currentSidePlayers[1]?.participant_id ??
                                                '';
                                              const firstGender = normalizeTournamentGender(
                                                roster.find((p) => p.id === firstPlayerId)
                                                  ?.gender_override ??
                                                  roster.find((p) => p.id === firstPlayerId)
                                                    ?.gender,
                                              );
                                              return (
                                                <div
                                                  key={`${m.id}-pairing-${side}`}
                                                  className="mt-3 rounded-md bg-secondary/30 p-3"
                                                >
                                                  <p className="text-sm font-medium">
                                                    Your lineup (
                                                    {side === 1 ? 'Side one' : 'Side two'})
                                                  </p>
                                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                                    <label className="text-xs">
                                                      Player one
                                                      <select
                                                        id={`captain-pair-${m.id}-${side}-a`}
                                                        className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                                        value={firstPlayerId}
                                                        onChange={(event) =>
                                                          setCaptainLineups((current) => ({
                                                            ...current,
                                                            [lineupKey]: {
                                                              first: event.target.value,
                                                              second:
                                                                current[lineupKey]?.second ??
                                                                secondPlayerId,
                                                            },
                                                          }))
                                                        }
                                                      >
                                                        <option value="">Select player</option>
                                                        {roster.map((p) => {
                                                          const reason =
                                                            teamMatchGenderIneligibilityReason(
                                                              m.category,
                                                              p.gender_override ?? p.gender,
                                                            );
                                                          return (
                                                            <option
                                                              key={p.id}
                                                              value={p.id}
                                                              disabled={!!reason}
                                                            >
                                                              {reason
                                                                ? `${p.display_name} — ${reason}`
                                                                : p.display_name}
                                                            </option>
                                                          );
                                                        })}
                                                      </select>
                                                    </label>
                                                    <label className="text-xs">
                                                      Player two
                                                      <select
                                                        id={`captain-pair-${m.id}-${side}-b`}
                                                        className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                                        value={secondPlayerId}
                                                        onChange={(event) =>
                                                          setCaptainLineups((current) => ({
                                                            ...current,
                                                            [lineupKey]: {
                                                              first:
                                                                current[lineupKey]?.first ??
                                                                firstPlayerId,
                                                              second: event.target.value,
                                                            },
                                                          }))
                                                        }
                                                      >
                                                        <option value="">Select player</option>
                                                        {roster
                                                          .filter((p) => p.id !== firstPlayerId)
                                                          .map((p) => {
                                                            const eligibilityReason =
                                                              teamMatchGenderIneligibilityReason(
                                                                m.category,
                                                                p.gender_override ?? p.gender,
                                                              );
                                                            const sameMixedGender =
                                                              m.category === 'mixed' &&
                                                              firstGender !== null &&
                                                              normalizeTournamentGender(
                                                                p.gender_override ?? p.gender,
                                                              ) === firstGender;
                                                            const reason =
                                                              eligibilityReason ||
                                                              (sameMixedGender
                                                                ? 'Mixed matches require one male and one female player.'
                                                                : null);
                                                            return (
                                                              <option
                                                                key={p.id}
                                                                value={p.id}
                                                                disabled={!!reason}
                                                              >
                                                                {reason
                                                                  ? `${p.display_name} — ${reason}`
                                                                  : p.display_name}
                                                              </option>
                                                            );
                                                          })}
                                                      </select>
                                                    </label>
                                                  </div>
                                                  <label className="mt-3 flex items-center gap-2 text-xs">
                                                    <input
                                                      type="checkbox"
                                                      id={`captain-lineup-visible-${m.id}-${side}`}
                                                      defaultChecked={
                                                        side === 1
                                                          ? m.team_one_lineup_public === true
                                                          : m.team_two_lineup_public === true
                                                      }
                                                    />
                                                    Show this lineup to everyone on the public
                                                    tournament page
                                                  </label>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      void saveCaptainPairing(m, teamId, side)
                                                    }
                                                    className="mt-2 h-8 rounded-md border border-border px-3 text-sm"
                                                  >
                                                    Save lineup
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
                                          ) &&
                                          currentTime >=
                                            new Date(m.scheduled_at || eventStartsAt).getTime() &&
                                          ((m.score_sets ?? []).length > 0 ? (
                                            <button
                                              type="button"
                                              aria-label={`Edit result for ${m.team_one_name || 'Team one'} vs ${m.team_two_name || 'Team two'}`}
                                              title="Edit result"
                                              onClick={() => {
                                                setCaptainScoreDraft(
                                                  (m.score_sets ?? [])
                                                    .map((set) => `${set.one}-${set.two}`)
                                                    .join(', '),
                                                );
                                                setEditingCaptainMatch(m);
                                              }}
                                              className="mt-3 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-secondary"
                                            >
                                              <Pencil aria-hidden="true" className="h-4 w-4" />
                                            </button>
                                          ) : (
                                            <div className="mt-3 flex flex-wrap items-end gap-2">
                                              <label className="text-xs">
                                                Enter result (sets)
                                                <input
                                                  id={`captain-score-${m.id}`}
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
                                          ))}
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
      <ConfirmDialog
        open={!!editingCaptainMatch}
        title="Edit match result"
        description={
          <label className="block text-sm">
            Match score (sets)
            <input
              autoFocus
              value={captainScoreDraft}
              onChange={(event) => setCaptainScoreDraft(event.target.value)}
              placeholder="6-4, 3-6, 10-8"
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
        }
        confirmLabel={captainScoreSaving ? 'Saving…' : 'Save changes'}
        busy={captainScoreSaving}
        onCancel={() => setEditingCaptainMatch(null)}
        onConfirm={() => void submitCaptainScore()}
      />
    </div>
  );
}
