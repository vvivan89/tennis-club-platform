import { buildKnockoutSchedule, phaseStartAfterPrerequisites } from '@/lib/tournament-schedule';
import { pairKnockoutFirstRound } from '@/lib/knockout-draw';
import { effectiveTournamentGroup, tournamentGroupCount } from '@/lib/tournament-groups';
import {
  accumulateSideStats,
  compareTournamentEntries,
  compareTournamentHeadToHead,
  createSideStats,
  tournamentRankingPriority,
  tournamentRankingMetric,
} from '@/lib/tournament-standings';
import { pairMatchPlayerRows } from '@/lib/tournament-match';
import type { Match, Pair, Participant, Team } from '@/components/tournament-management-types';
import type { Props } from '@/components/use-tournament-draw-actions';

type KnockoutDrawProps = Pick<
  Props,
  | 'db'
  | 'eventId'
  | 'eventStartsAt'
  | 'eventEndsAt'
  | 'courtCount'
  | 'activeCategory'
  | 'isTeam'
  | 'isSingles'
  | 'matchCategory'
  | 'matchPhase'
  | 'config'
  | 'enabledPhases'
  | 'scheduleTimings'
  | 'teams'
  | 'pairs'
  | 'participants'
  | 'matches'
  | 'refresh'
  | 'insertMatchPlayers'
  | 'setBusy'
  | 'setError'
  | 'setMessage'
>;

export function createTournamentKnockoutDrawAction({
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
  refresh,
  insertMatchPlayers,
  setBusy,
  setError,
  setMessage,
}: KnockoutDrawProps) {
  return async function randomizeKnockoutDraw() {
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
      const category = isTeam ? matchCategory : activeCategory;
      const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
      const roundRobinEnabled =
        phase === (isTeam ? 'team_knockout' : 'final_knockout') &&
        (isTeam ? enabledPhases.team_round_robin !== false : enabledPhases.round_robin !== false);
      type Slot = { id: string | null; label: string; group: number | null; rank: number | null };
      let slots: Slot[] = [];
      const shuffled = <T>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
      const allSides: Array<Team | Pair | Participant> = isTeam
        ? teams
        : isSingles
          ? participants.filter(
              (player) => player.status === 'registered' && player.category === activeCategory,
            )
          : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory);
      if (roundRobinEnabled) {
        const singleGroup = tournamentGroupCount(config) === 1;
        if (!singleGroup && allSides.some((side) => !side.group_number))
          throw new Error(
            'Assign every team or pair to a group before generating the knockout draw.',
          );
        const promote = Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
        const configuredGroupCount = tournamentGroupCount(config);
        const groups = allSides.length
          ? [
              ...new Set(
                allSides
                  .map((side) => effectiveTournamentGroup(side.group_number, config))
                  .filter((n): n is number => !!n),
              ),
            ].sort((a, b) => a - b)
          : Array.from({ length: configuredGroupCount }, (_, index) => index + 1);
        const groupRanked = groups.map((groupNumber) => {
          const groupSides = allSides.filter(
            (side) => effectiveTournamentGroup(side.group_number, config) === groupNumber,
          );
          const relevantMatches = matches.filter(
            (m) =>
              m.category === category &&
              m.phase === roundRobinPhase &&
              effectiveTournamentGroup(m.group_number, config) === groupNumber &&
              m.status !== 'cancelled',
          );
          const expected = (groupSides.length * (groupSides.length - 1)) / 2;
          const complete =
            expected > 0 &&
            relevantMatches.filter((m) => m.status === 'completed' || m.winner_side != null)
              .length >= expected;
          const stats = groupSides
            .map((side) =>
              accumulateSideStats(
                createSideStats(side),
                relevantMatches,
                isTeam ? true : isSingles ? 'singles' : false,
              ),
            )
            .sort((a, b) => {
              const priority = tournamentRankingPriority(config, isTeam);
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
                    isTeam ? true : isSingles ? 'singles' : false,
                  ),
                (row) =>
                  'name' in row.side
                    ? row.side.name
                    : 'display_name' in row.side
                      ? row.side.display_name
                      : row.side.player_one_name || '',
              );
            });
          return { groupNumber, stats, complete };
        });
        for (let rank = 1; rank <= promote; rank++) {
          for (const group of groupRanked) {
            const entry = group.stats[rank - 1];
            slots.push({
              id: group.complete && entry ? entry.side.id : null,
              label: `Group ${group.groupNumber} ${isSingles ? 'Player' : 'Team'} ${rank}`,
              group: group.groupNumber,
              rank,
            });
          }
        }
      } else {
        slots = shuffled(allSides).map((side) => ({
          id: side.id,
          label: 'TBD',
          group: side.group_number ?? null,
          rank: null,
        }));
        if (slots.length === 0) {
          const placeholderGroupCount = tournamentGroupCount(config);
          const placeholderPromotions = Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
          slots = Array.from(
            { length: placeholderGroupCount * placeholderPromotions },
            (_, index) => ({
              id: null,
              label: `Group ${Math.floor(index / placeholderPromotions) + 1} ${isSingles ? 'Player' : 'Team'} ${(index % placeholderPromotions) + 1}`,
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
              : isSingles
                ? {
                    player_one_participant_id: first?.id ?? null,
                    player_two_participant_id: second?.id ?? null,
                  }
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
          : isSingles
            ? bye.winner_side === 1
              ? bye.player_one_participant_id
              : bye.player_two_participant_id
            : bye.winner_side === 1
              ? bye.pair_one_id
              : bye.pair_two_id;
        if (next && winnerId) {
          const targetSide = bye.match_number % 2 === 1 ? 1 : 2;
          const field = isTeam
            ? targetSide === 1
              ? 'team_one_id'
              : 'team_two_id'
            : isSingles
              ? targetSide === 1
                ? 'player_one_participant_id'
                : 'player_two_participant_id'
              : isSingles
                ? targetSide === 1
                  ? 'player_one_participant_id'
                  : 'player_two_participant_id'
                : targetSide === 1
                  ? 'pair_one_id'
                  : 'pair_two_id';
          const { error: byeAdvanceError } = await db
            .from('tournament_matches')
            .update({ [field]: winnerId })
            .eq('id', next.id);
          if (byeAdvanceError) throw new Error(byeAdvanceError.message);
          (next as unknown as Record<string, unknown>)[field] = winnerId;
          if (!isTeam && !isSingles) {
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
      if (!isTeam && !isSingles) {
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
  };
}
