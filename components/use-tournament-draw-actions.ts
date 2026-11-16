import type { Dispatch, SetStateAction } from 'react';
import type { TournamentConfig } from '@/lib/tournament-config';
import { effectiveTournamentGroup } from '@/lib/tournament-groups';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { tournamentRankingPriority } from '@/lib/tournament-standings';
import type {
  Match,
  MatchPlayer,
  Pair,
  Participant,
  Team,
} from '@/components/tournament-management-types';
import { useTournamentScoreActions } from '@/components/use-tournament-score-actions';
import { createTournamentKnockoutDrawAction } from '@/components/create-tournament-knockout-draw-action';

type Db = ReturnType<typeof createSupabaseBrowserClient>;
type ActionResult = { error: { message: string } | null };
type PendingWalkover = { match: Match; raw: string };
type PendingDeleteMatch = Match | null;
export type Props = {
  db: Db;
  eventId: string;
  eventStartsAt: string;
  eventEndsAt: string | null;
  courtCount: number;
  activeCategory: string;
  isTeam: boolean;
  isSingles?: boolean;
  matchCategory: string;
  matchPhase: string;
  config: TournamentConfig | null;
  enabledPhases: Record<string, boolean | undefined>;
  scheduleTimings: { duration: number; breakMinutes: number };
  teams: Team[];
  pairs: Pair[];
  participants?: Participant[];
  matches: Match[];
  matchPlayers: MatchPlayer[];
  pendingDeleteMatch: PendingDeleteMatch;
  refresh: () => Promise<void>;
  insertMatchPlayers: (
    assignments: Array<{ match_id: string; participant_id: string; side: number; team_id: null }>,
  ) => Promise<void>;
  saveMatch: (match: Match, changes: Partial<Match>) => Promise<boolean>;
  runAction: (action: () => PromiseLike<ActionResult>, success: string) => Promise<boolean>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingDeleteMatch: Dispatch<SetStateAction<PendingDeleteMatch>>;
  setPendingWalkoverScore: Dispatch<SetStateAction<PendingWalkover | null>>;
};

export function useTournamentDrawActions({
  db,
  eventId,
  eventStartsAt,
  eventEndsAt,
  courtCount,
  activeCategory,
  isTeam,
  isSingles = false,
  matchCategory,
  matchPhase,
  config,
  enabledPhases,
  scheduleTimings,
  teams,
  pairs,
  participants = [],
  matches,
  matchPlayers,
  pendingDeleteMatch,
  refresh,
  insertMatchPlayers,
  saveMatch,
  runAction,
  setBusy,
  setError,
  setMessage,
  setPendingDeleteMatch,
  setPendingWalkoverScore,
}: Props) {
  async function syncUnplayedRoundRobinMatches() {
    const category = isTeam ? matchCategory : activeCategory;
    const phase = isTeam ? 'team_round_robin' : 'round_robin';
    const entryResult = isTeam
      ? await db.from('tournament_teams').select('id,group_number').eq('event_id', eventId)
      : isSingles
        ? await db
            .from('tournament_participants')
            .select('id,group_number')
            .eq('event_id', eventId)
            .eq('category', activeCategory)
            .eq('status', 'registered')
        : await db
            .from('tournament_pairs')
            .select('id,group_number')
            .eq('event_id', eventId)
            .eq('category', activeCategory)
            .neq('status', 'withdrawn');
    if (entryResult.error) return { error: entryResult.error };
    const matchResult = await db
      .from('tournament_matches')
      .select('*')
      .eq('event_id', eventId)
      .eq('category', category)
      .eq('phase', phase);
    if (matchResult.error) return { error: matchResult.error };
    const groupById = new Map(
      (entryResult.data ?? []).map(
        (entry: { id: string; group_number: number | null }) =>
          [entry.id, entry.group_number] as const,
      ),
    );
    for (const match of (matchResult.data ?? []) as Match[]) {
      if (
        match.status === 'completed' ||
        match.status === 'cancelled' ||
        match.winner_side != null ||
        (match.score_sets?.length ?? 0) > 0
      )
        continue;
      const oneId = isTeam
        ? match.team_one_id
        : isSingles
          ? match.player_one_participant_id
          : match.pair_one_id;
      const twoId = isTeam
        ? match.team_two_id
        : isSingles
          ? match.player_two_participant_id
          : match.pair_two_id;
      const oneGroup = oneId ? effectiveTournamentGroup(groupById.get(oneId), config) : null;
      const twoGroup = twoId ? effectiveTournamentGroup(groupById.get(twoId), config) : null;
      const sameGroup = !!oneGroup && oneGroup === twoGroup;
      const { error } = await db
        .from('tournament_matches')
        .update({
          group_number: sameGroup ? oneGroup : null,
          status: sameGroup ? match.status : 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', match.id);
      if (error) return { error };
    }
    return { error: null };
  }

  async function saveEntryGroup(entryId: string, groupNumber: number | null) {
    // Update only the field shared by both entry tables.
    const changes = { group_number: groupNumber };
    const result = isTeam
      ? await db.from('tournament_teams').update(changes).eq('id', entryId)
      : isSingles
        ? await db.from('tournament_participants').update(changes).eq('id', entryId)
        : await db
            .from('tournament_pairs')
            .update(changes)
            .eq('id', entryId)
            .eq('category', activeCategory);
    if (result.error) return { error: result.error };
    return syncUnplayedRoundRobinMatches();
  }

  async function randomizeGroups() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const groupCount = Math.max(1, Number(config?.group_count ?? 2));
      const shuffled = <T>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
      if (isTeam) {
        const draw = shuffled(teams);
        for (let index = 0; index < draw.length; index++) {
          const { error: updateError } = await db
            .from('tournament_teams')
            .update({ group_number: (index % groupCount) + 1 })
            .eq('id', draw[index].id);
          if (updateError) throw new Error(updateError.message);
        }
      } else if (isSingles) {
        const draw = shuffled(
          participants.filter(
            (player) => player.status === 'registered' && player.category === activeCategory,
          ),
        );
        for (let index = 0; index < draw.length; index++) {
          const { error: updateError } = await db
            .from('tournament_participants')
            .update({ group_number: (index % groupCount) + 1 })
            .eq('id', draw[index].id);
          if (updateError) throw new Error(updateError.message);
        }
      } else {
        const draw = shuffled(
          pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory),
        );
        for (let index = 0; index < draw.length; index++) {
          const { error: updateError } = await db
            .from('tournament_pairs')
            .update({ group_number: (index % groupCount) + 1 })
            .eq('id', draw[index].id);
          if (updateError) throw new Error(updateError.message);
        }
      }
      const syncResult = await syncUnplayedRoundRobinMatches();
      if (syncResult.error) throw new Error(syncResult.error.message);
      setMessage(
        'Random draw assigned entries as evenly as possible. Unplayed round-robin matches were reconciled with the new groups; completed results were preserved.',
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not randomize groups.');
    } finally {
      setBusy(false);
    }
  }
  async function syncPromotedKnockoutEntrants() {
    const category = isTeam ? matchCategory : activeCategory;
    const knockoutPhase = isTeam ? 'team_knockout' : 'final_knockout';
    const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
    const roundRobinEnabled = isTeam
      ? enabledPhases.team_round_robin !== false
      : enabledPhases.round_robin !== false;
    if (!roundRobinEnabled) return;
    const entrants: Array<Team | Pair | Participant> = isTeam
      ? teams
      : isSingles
        ? participants.filter(
            (player) => player.category === activeCategory && player.status === 'registered',
          )
        : pairs.filter((pair) => pair.category === activeCategory && pair.status !== 'withdrawn');
    if (!entrants.length) return;
    const { data: roundRobinRows, error: roundRobinError } = await db
      .from('tournament_matches')
      .select('*')
      .eq('event_id', eventId)
      .eq('category', category)
      .eq('phase', roundRobinPhase)
      .neq('status', 'cancelled');
    if (roundRobinError) throw new Error(roundRobinError.message);
    const roundRobinMatches = (roundRobinRows ?? []) as Match[];
    const { data: rankingOverrideRows, error: rankingOverrideError } = await db
      .from('tournament_group_overrides')
      .select('entry_id,override_value,override_type,category,group_number')
      .eq('event_id', eventId)
      .eq('category', category);
    if (rankingOverrideError) throw new Error(rankingOverrideError.message);
    const persistedOverrides = (rankingOverrideRows ?? []) as Array<{
      entry_id: string;
      override_value: number;
      override_type: 'ranking' | 'promotion';
      category: string;
      group_number: number;
    }>;
    const groups = [
      ...new Set(
        entrants
          .map((entry) => effectiveTournamentGroup(entry.group_number, config))
          .filter((n): n is number => n != null),
      ),
    ];
    const rankedByGroup = new Map<number, Array<{ id: string; name: string }>>();
    for (const groupNumber of groups) {
      const groupEntrants = entrants.filter(
        (entry) => effectiveTournamentGroup(entry.group_number, config) === groupNumber,
      );
      const groupMatches = roundRobinMatches.filter(
        (match) => effectiveTournamentGroup(match.group_number, config) === groupNumber,
      );
      const expectedMatches = (groupEntrants.length * (groupEntrants.length - 1)) / 2;
      if (
        !expectedMatches ||
        groupMatches.filter((match) => match.status === 'completed' || match.winner_side != null)
          .length < expectedMatches
      )
        continue;
      const stats = groupEntrants.map((entry) => {
        const id = entry.id;
        const row = {
          id,
          name:
            ('name' in entry
              ? entry.name
              : 'display_name' in entry
                ? entry.display_name
                : entry.player_one_name) ?? '',
          wins: 0,
          points: 0,
          setsWon: 0,
          setsLost: 0,
          gamesWon: 0,
          gamesLost: 0,
        };
        for (const match of groupMatches) {
          const oneId = isTeam
            ? match.team_one_id
            : isSingles
              ? match.player_one_participant_id
              : match.pair_one_id;
          const twoId = isTeam
            ? match.team_two_id
            : isSingles
              ? match.player_two_participant_id
              : match.pair_two_id;
          if (oneId !== id && twoId !== id) continue;
          if (
            (match.winner_side === 1 && oneId === id) ||
            (match.winner_side === 2 && twoId === id)
          )
            row.wins++;
          if (isTeam)
            row.points +=
              oneId === id
                ? Number(match.team_points_one ?? 0)
                : Number(match.team_points_two ?? 0);
          for (const set of match.score_sets ?? []) {
            const own = oneId === id ? set.one : set.two;
            const against = oneId === id ? set.two : set.one;
            row.setsWon += own > against ? 1 : 0;
            row.setsLost += own < against ? 1 : 0;
            row.gamesWon += own;
            row.gamesLost += against;
          }
        }
        return row;
      });
      const priority = tournamentRankingPriority(config, isTeam);
      stats.sort((a, b) => {
        for (const key of priority) {
          if (key === 'head_to_head') {
            const direct = groupMatches.find((match) => {
              const oneId = isTeam
                ? match.team_one_id
                : isSingles
                  ? match.player_one_participant_id
                  : match.pair_one_id;
              const twoId = isTeam
                ? match.team_two_id
                : isSingles
                  ? match.player_two_participant_id
                  : match.pair_two_id;
              return (
                match.winner_side != null &&
                ((oneId === a.id && twoId === b.id) || (oneId === b.id && twoId === a.id))
              );
            });
            if (direct?.winner_side) {
              const oneId = isTeam
                ? direct.team_one_id
                : isSingles
                  ? direct.player_one_participant_id
                  : direct.pair_one_id;
              const aWon = oneId === a.id ? direct.winner_side === 1 : direct.winner_side === 2;
              return aWon ? -1 : 1;
            }
            continue;
          }
          const value = (row: typeof a) =>
            key === 'points'
              ? row.points
              : key === 'matches_won'
                ? row.wins
                : key === 'sets_won'
                  ? row.setsWon
                  : key === 'games_won'
                    ? row.gamesWon
                    : key === 'set_difference'
                      ? row.setsWon - row.setsLost
                      : key === 'game_difference'
                        ? row.gamesWon - row.gamesLost
                        : 0;
          const difference = value(b) - value(a);
          if (difference) return difference;
        }
        return a.name.localeCompare(b.name);
      });
      const manualRanks = persistedOverrides
        .filter((item) => item.group_number === groupNumber && item.override_type === 'ranking')
        .sort((a, b) => a.override_value - b.override_value);
      for (const override of manualRanks) {
        const currentIndex = stats.findIndex((row) => row.id === override.entry_id);
        if (currentIndex < 0) continue;
        const [row] = stats.splice(currentIndex, 1);
        stats.splice(Math.max(0, Math.min(stats.length, override.override_value - 1)), 0, row);
      }
      rankedByGroup.set(
        groupNumber,
        stats.map(({ id, name }) => ({ id, name })),
      );
    }
    const { data: bracketRows, error: bracketError } = await db
      .from('tournament_matches')
      .select('*')
      .eq('event_id', eventId)
      .eq('category', category)
      .in('phase', isTeam ? [knockoutPhase] : ['preliminary_knockout', knockoutPhase])
      .eq('round_number', 1);
    if (bracketError) throw new Error(bracketError.message);
    let promotedSlotsUpdated = false;
    for (const match of (bracketRows ?? []) as Match[]) {
      let notes: { slot_one?: string | null; slot_two?: string | null } = {};
      try {
        notes = JSON.parse(match.notes || '{}') as typeof notes;
      } catch {
        continue;
      }
      const changes: Record<string, unknown> = {};
      for (const side of [1, 2] as const) {
        const label = side === 1 ? notes.slot_one : notes.slot_two;
        const parsed = label?.match(/^Group (\d+) (?:Team|Player) (\d+)$/);
        if (!parsed) continue;
        const promoted = rankedByGroup.get(Number(parsed[1]))?.[Number(parsed[2]) - 1];
        if (!promoted) continue;
        changes[
          isTeam
            ? side === 1
              ? 'team_one_id'
              : 'team_two_id'
            : isSingles
              ? side === 1
                ? 'player_one_participant_id'
                : 'player_two_participant_id'
              : side === 1
                ? 'pair_one_id'
                : 'pair_two_id'
        ] = promoted.id;
        if (side === 1) notes.slot_one = null;
        else notes.slot_two = null;
      }
      if (Object.keys(changes).length) {
        changes.notes = JSON.stringify(notes);
        changes.updated_at = new Date().toISOString();
        const { error: updateError } = await db
          .from('tournament_matches')
          .update(changes)
          .eq('id', match.id);
        if (updateError) throw new Error(updateError.message);
        promotedSlotsUpdated = true;
      }
    }
    if (promotedSlotsUpdated) await refresh();
  }

  const randomizeKnockoutDraw = createTournamentKnockoutDrawAction({
    db,
    eventId,
    eventStartsAt,
    eventEndsAt,
    courtCount,
    activeCategory,
    isTeam,
    isSingles,
    matchCategory,
    matchPhase,
    config,
    enabledPhases,
    scheduleTimings,
    teams,
    pairs,
    participants,
    matches,
    refresh,
    insertMatchPlayers,
    setBusy,
    setError,
    setMessage,
  });
  const scoreActions = useTournamentScoreActions({
    db,
    eventStartsAt,
    isTeam,
    isSingles,
    config,
    matches,
    pairs,
    matchPlayers,
    pendingDeleteMatch,
    refresh,
    runAction,
    saveMatch,
    syncPromotedKnockoutEntrants,
    setError,
    setMessage,
    setPendingDeleteMatch,
    setPendingWalkoverScore,
  });

  return {
    syncUnplayedRoundRobinMatches,
    saveEntryGroup,
    randomizeGroups,
    syncPromotedKnockoutEntrants,
    randomizeKnockoutDraw,
    ...scoreActions,
  };
}
