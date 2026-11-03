import type { Dispatch, SetStateAction } from 'react';
import { buildKnockoutSchedule, phaseStartAfterPrerequisites } from '@/lib/tournament-schedule';
import { pairKnockoutFirstRound } from '@/lib/knockout-draw';
import type { TournamentConfig } from '@/lib/tournament-config';
import {
  accumulateSideStats,
  compareTournamentEntries,
  compareTournamentHeadToHead,
  createSideStats,
  defaultRankingPriority,
  tournamentRankingMetric,
} from '@/lib/tournament-standings';
import { pairMatchPlayerRows } from '@/lib/tournament-match';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { Match, MatchPlayer, Pair, Team } from '@/components/tournament-management-types';
import { useTournamentScoreActions } from '@/components/use-tournament-score-actions';

type Db = ReturnType<typeof createSupabaseBrowserClient>;
type ActionResult = { error: { message: string } | null };
type PendingWalkover = { match: Match; raw: string };
type PendingDeleteMatch = Match | null;
type Props = {
  db: Db;
  eventId: string;
  eventStartsAt: string;
  eventEndsAt: string | null;
  courtCount: number;
  activeCategory: string;
  isTeam: boolean;
  matchCategory: string;
  matchPhase: string;
  config: TournamentConfig | null;
  enabledPhases: Record<string, boolean | undefined>;
  scheduleTimings: { duration: number; breakMinutes: number };
  teams: Team[];
  pairs: Pair[];
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
  matchCategory,
  matchPhase,
  config,
  enabledPhases,
  scheduleTimings,
  teams,
  pairs,
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
    const category = isTeam ? 'team' : activeCategory;
    const phase = isTeam ? 'team_round_robin' : 'round_robin';
    const entryResult = isTeam
      ? await db.from('tournament_teams').select('id,group_number').eq('event_id', eventId)
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
      const oneId = isTeam ? match.team_one_id : match.pair_one_id;
      const twoId = isTeam ? match.team_two_id : match.pair_two_id;
      const oneGroup = oneId ? groupById.get(oneId) : null;
      const twoGroup = twoId ? groupById.get(twoId) : null;
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
    const category = isTeam ? 'team' : activeCategory;
    const knockoutPhase = isTeam ? 'team_knockout' : 'final_knockout';
    const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
    const roundRobinEnabled = isTeam
      ? enabledPhases.team_round_robin !== false
      : enabledPhases.round_robin !== false;
    if (!roundRobinEnabled) return;
    const entrants: Array<Team | Pair> = isTeam
      ? teams
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
      ...new Set(entrants.map((entry) => entry.group_number).filter((n): n is number => n != null)),
    ];
    const rankedByGroup = new Map<number, Array<{ id: string; name: string }>>();
    for (const groupNumber of groups) {
      const groupEntrants = entrants.filter((entry) => entry.group_number === groupNumber);
      const groupMatches = roundRobinMatches.filter((match) => match.group_number === groupNumber);
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
          name: ('name' in entry ? entry.name : entry.player_one_name) ?? '',
          wins: 0,
          points: 0,
          setsWon: 0,
          setsLost: 0,
          gamesWon: 0,
          gamesLost: 0,
        };
        for (const match of groupMatches) {
          const oneId = isTeam ? match.team_one_id : match.pair_one_id;
          const twoId = isTeam ? match.team_two_id : match.pair_two_id;
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
      const priority =
        config?.ranking_priority ??
        (isTeam
          ? ['points', 'matches_won', 'sets_won', 'games_won', 'set_difference', 'game_difference']
          : ['matches_won', 'sets_won', 'games_won', 'set_difference', 'game_difference']);
      stats.sort((a, b) => {
        for (const key of priority) {
          if (key === 'head_to_head') {
            const direct = groupMatches.find((match) => {
              const oneId = isTeam ? match.team_one_id : match.pair_one_id;
              const twoId = isTeam ? match.team_two_id : match.pair_two_id;
              return (
                match.winner_side != null &&
                ((oneId === a.id && twoId === b.id) || (oneId === b.id && twoId === a.id))
              );
            });
            if (direct?.winner_side) {
              const oneId = isTeam ? direct.team_one_id : direct.pair_one_id;
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
        const parsed = label?.match(/^Group (\d+) Team (\d+)$/);
        if (!parsed) continue;
        const promoted = rankedByGroup.get(Number(parsed[1]))?.[Number(parsed[2]) - 1];
        if (!promoted) continue;
        changes[
          isTeam
            ? side === 1
              ? 'team_one_id'
              : 'team_two_id'
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

  async function randomizeKnockoutDraw() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (
        matches.some(
          (match) =>
            match.category === matchCategory &&
            match.phase.includes('knockout') &&
            (match.status === 'completed' ||
              match.winner_side != null ||
              (match.score_sets?.length ?? 0) > 0),
        )
      ) {
        throw new Error(
          'The knockout bracket cannot be regenerated because match results exist. Edit the bracket manually instead.',
        );
      }
      const phase = matchPhase;
      const category = isTeam ? 'team' : activeCategory;
      const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
      const roundRobinEnabled =
        phase === (isTeam ? 'team_knockout' : 'final_knockout') &&
        (isTeam ? enabledPhases.team_round_robin !== false : enabledPhases.round_robin !== false);
      type Slot = { id: string | null; label: string; group: number | null; rank: number | null };
      let slots: Slot[] = [];
      const shuffled = <T>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
      const allSides: Array<Team | Pair> = isTeam
        ? teams
        : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory);
      if (roundRobinEnabled) {
        if (allSides.some((side) => !side.group_number))
          throw new Error(
            'Assign every team or pair to a group before generating the knockout draw.',
          );
        const promote = Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
        const configuredGroupCount = Math.max(2, Number(config?.group_count ?? 2));
        const groups = allSides.length
          ? [
              ...new Set(allSides.map((side) => side.group_number).filter((n): n is number => !!n)),
            ].sort((a, b) => a - b)
          : Array.from({ length: configuredGroupCount }, (_, index) => index + 1);
        const groupRanked = groups.map((groupNumber) => {
          const groupSides = allSides.filter((side) => side.group_number === groupNumber);
          const relevantMatches = matches.filter(
            (m) =>
              m.category === category &&
              m.phase === roundRobinPhase &&
              m.group_number === groupNumber &&
              m.status !== 'cancelled',
          );
          const expected = (groupSides.length * (groupSides.length - 1)) / 2;
          const complete =
            expected > 0 &&
            relevantMatches.filter((m) => m.status === 'completed' || m.winner_side != null)
              .length >= expected;
          const stats = groupSides
            .map((side) => accumulateSideStats(createSideStats(side), relevantMatches, isTeam))
            .sort((a, b) => {
              const priority = config?.ranking_priority ?? defaultRankingPriority(isTeam);
              const metric = tournamentRankingMetric;
              return compareTournamentEntries(
                a,
                b,
                priority,
                metric,
                (first, second) =>
                  compareTournamentHeadToHead(
                    relevantMatches,
                    first.side.id,
                    second.side.id,
                    isTeam,
                  ),
                (row) => ('name' in row.side ? row.side.name : row.side.player_one_name || ''),
              );
            });
          return { groupNumber, stats, complete };
        });
        for (let rank = 1; rank <= promote; rank++) {
          for (const group of groupRanked) {
            const entry = group.stats[rank - 1];
            slots.push({
              id: group.complete && entry ? entry.side.id : null,
              label: entry
                ? `Group ${group.groupNumber} Team ${rank}`
                : `Group ${group.groupNumber} Team ${rank}`,
              group: group.groupNumber,
              rank,
            });
          }
        }
      } else {
        slots = shuffled(allSides).map((side) => ({
          id: side.id,
          label: 'TBD',
          group: side.group_number,
          rank: null,
        }));
        if (slots.length === 0) {
          const placeholderGroupCount = Math.max(2, Number(config?.group_count ?? 2));
          const placeholderPromotions = Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
          slots = Array.from(
            { length: placeholderGroupCount * placeholderPromotions },
            (_, index) => ({
              id: null,
              label: `Group ${Math.floor(index / placeholderPromotions) + 1} Team ${(index % placeholderPromotions) + 1}`,
              group: Math.floor(index / placeholderPromotions) + 1,
              rank: (index % placeholderPromotions) + 1,
            }),
          );
        }
      }
      if (slots.length < 2)
        throw new Error('At least two eligible teams or pairs are required for a knockout draw.');
      const bracketSize = 2 ** Math.ceil(Math.log2(slots.length));
      while (slots.length < bracketSize)
        slots.push({ id: null, label: 'Bye', group: null, rank: null });
      slots = pairKnockoutFirstRound({
        slots,
        roundRobinEnabled,
        promotedPerGroup: Math.max(1, Number(config?.promoted_teams_per_group ?? 2)),
      }).flat();
      const existingDraw = matches.filter(
        (match) => match.category === category && match.phase === phase,
      );
      if (
        existingDraw.some(
          (match) =>
            match.status === 'completed' ||
            (match.score_sets?.length ?? 0) > 0 ||
            match.winner_side != null,
        )
      ) {
        throw new Error(
          'This knockout stage already has results. Existing match history will not be replaced.',
        );
      }
      const eventEnd = new Date(eventEndsAt || eventStartsAt);
      const { duration, breakMinutes } = scheduleTimings;
      const prerequisitePhases =
        phase === (isTeam ? 'team_knockout' : 'final_knockout')
          ? isTeam
            ? ['team_round_robin']
            : ['preliminary_knockout', 'round_robin']
          : [];
      let phaseStart = new Date(eventStartsAt);
      if (prerequisitePhases.length) {
        const { data: prerequisiteRows, error: prerequisiteError } = await db
          .from('tournament_matches')
          .select('scheduled_at,status,phase')
          .eq('event_id', eventId)
          .eq('category', category)
          .in('phase', prerequisitePhases)
          .neq('status', 'cancelled');
        if (prerequisiteError) throw new Error(prerequisiteError.message);
        phaseStart = phaseStartAfterPrerequisites({
          baseStart: eventStartsAt,
          prerequisiteMatches: (prerequisiteRows ?? []).map((match) => ({
            scheduled_at: match.scheduled_at as string | null,
            status: String(match.status),
          })),
          matchMinutes: duration,
          minimumBreakMinutes: 60,
        });
      }
      if (existingDraw.length) {
        const existingIds = existingDraw.map((match) => match.id);
        const { error: playersDeleteError } = await db
          .from('tournament_match_players')
          .delete()
          .in('match_id', existingIds);
        if (playersDeleteError) throw new Error(playersDeleteError.message);
        const { error: matchesDeleteError } = await db
          .from('tournament_matches')
          .delete()
          .in('id', existingIds);
        if (matchesDeleteError) throw new Error(matchesDeleteError.message);
      }
      const rows: Record<string, unknown>[] = [];
      const rounds = Math.log2(bracketSize);
      let count = bracketSize / 2;
      for (let round = 1; round <= rounds; round++) {
        for (let matchNumber = 1; matchNumber <= count; matchNumber++) {
          const first = round === 1 ? slots[(matchNumber - 1) * 2] : null;
          const second = round === 1 ? slots[(matchNumber - 1) * 2 + 1] : null;
          const notes =
            round === 1
              ? JSON.stringify({
                  slot_one: first?.id ? null : (first?.label ?? 'TBD'),
                  slot_two: second?.id ? null : (second?.label ?? 'TBD'),
                })
              : JSON.stringify({
                  slot_one: `Winner of ${round === 2 ? 'Round 1' : `Round ${round - 1}`} ${matchNumber * 2 - 1}`,
                  slot_two: `Winner of ${round === 2 ? 'Round 1' : `Round ${round - 1}`} ${matchNumber * 2}`,
                });
          // A generated BYE must be recognized even when the opposing side is
          // an unresolved group-place slot (e.g. "Group 3 Team 2") with no ID yet.
          // winner_side points to the side that advances; matchSideValue uses it
          // to preselect BYE in the opposite dropdown.
          const firstIsDefinedEntrant =
            Boolean(first?.id) ||
            Boolean(first?.label && first.label !== 'Bye' && first.label !== 'TBD');
          const secondIsDefinedEntrant =
            Boolean(second?.id) ||
            Boolean(second?.label && second.label !== 'Bye' && second.label !== 'TBD');
          const byeWinner =
            round === 1
              ? first?.label === 'Bye' && secondIsDefinedEntrant
                ? 2
                : second?.label === 'Bye' && firstIsDefinedEntrant
                  ? 1
                  : null
              : null;
          rows.push({
            event_id: eventId,
            category,
            phase,
            round_number: round,
            match_number: matchNumber,
            status: byeWinner ? 'bye' : 'scheduled',
            winner_side: byeWinner,
            notes,
            ...(isTeam
              ? { team_one_id: first?.id ?? null, team_two_id: second?.id ?? null }
              : { pair_one_id: first?.id ?? null, pair_two_id: second?.id ?? null }),
          });
        }
        count = Math.ceil(count / 2);
      }
      const { data: createdMatches, error: insertError } = await db
        .from('tournament_matches')
        .insert(rows)
        .select('*');
      if (insertError) throw new Error(insertError.message);
      // A bye advances automatically without occupying a court or counting as a played match.
      for (const bye of (createdMatches ?? []).filter(
        (match: Match) =>
          match.status === 'bye' && match.winner_side && match.round_number < rounds,
      )) {
        const next = (createdMatches ?? []).find(
          (match: Match) =>
            match.round_number === bye.round_number + 1 &&
            match.match_number === Math.ceil(bye.match_number / 2),
        ) as Match | undefined;
        const winnerId = isTeam
          ? bye.winner_side === 1
            ? bye.team_one_id
            : bye.team_two_id
          : bye.winner_side === 1
            ? bye.pair_one_id
            : bye.pair_two_id;
        if (next && winnerId) {
          const targetSide = bye.match_number % 2 === 1 ? 1 : 2;
          const field = isTeam
            ? targetSide === 1
              ? 'team_one_id'
              : 'team_two_id'
            : targetSide === 1
              ? 'pair_one_id'
              : 'pair_two_id';
          const { error: byeAdvanceError } = await db
            .from('tournament_matches')
            .update({ [field]: winnerId })
            .eq('id', next.id);
          if (byeAdvanceError) throw new Error(byeAdvanceError.message);
          (next as unknown as Record<string, unknown>)[field] = winnerId;
          if (!isTeam) {
            const winnerPair = pairs.find((pair) => pair.id === winnerId);
            if (winnerPair) {
              const { error: playerAssignmentError } = await db
                .from('tournament_match_players')
                .insert([
                  {
                    match_id: next.id,
                    participant_id: winnerPair.player_one_id,
                    side: targetSide,
                    team_id: null,
                  },
                  {
                    match_id: next.id,
                    participant_id: winnerPair.player_two_id,
                    side: targetSide,
                    team_id: null,
                  },
                ]);
              if (playerAssignmentError) throw new Error(playerAssignmentError.message);
            }
          }
        }
      }
      const knockoutAssignments = buildKnockoutSchedule({
        matches: ((createdMatches ?? []) as Match[]).map((match) => ({
          id: match.id,
          round_number: match.round_number,
          match_number: match.match_number,
          status: match.status,
        })),
        baseStart: phaseStart,
        eventEnd,
        matchMinutes: duration,
        betweenMatchBreakMinutes: breakMinutes,
        courtCount,
        stageBreakMinutes: 60,
      });
      for (const assignment of knockoutAssignments) {
        const { error: scheduleError } = await db
          .from('tournament_matches')
          .update({ scheduled_at: assignment.scheduled_at, court_number: assignment.court_number })
          .eq('id', assignment.id);
        if (scheduleError) throw new Error(scheduleError.message);
        const created = ((createdMatches ?? []) as Match[]).find(
          (match) => match.id === assignment.id,
        );
        if (created) {
          created.scheduled_at = assignment.scheduled_at;
          created.court_number = assignment.court_number;
        }
      }
      // Assign participant history for all first-round matches with known pairs.
      if (!isTeam) {
        await insertMatchPlayers(
          (createdMatches ?? [])
            .filter((m: Match) => m.round_number === 1 && m.pair_one_id && m.pair_two_id)
            .flatMap((match: Match) => pairMatchPlayerRows(match, pairs)),
        );
      }
      setMessage(
        `Created a ${rounds}-round knockout bracket and suggested a schedule. Review the draw and edit any match as needed.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate knockout draw.');
    } finally {
      setBusy(false);
    }
  }
  const scoreActions = useTournamentScoreActions({
    db,
    isTeam,
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
