import { useMemo } from 'react';
import type { TournamentConfig } from '@/lib/tournament-config';
import { compareByScheduleThenMatchNumber, roundNumbersByMatch } from '@/lib/tournament-match';
import type { Match, Pair } from '@/components/tournament-public-view-types';

export function useTournamentVisibleMatchData({
  matches,
  pairs,
  config,
  format,
  activeCategory,
  ownTeamIds,
  ownParticipantIds,
}: {
  matches: Match[];
  pairs: Pair[];
  config: TournamentConfig | null;
  format: string | null;
  activeCategory: string;
  ownTeamIds: string[];
  ownParticipantIds: string[];
}) {
  const ownNextMatch = useMemo(
    () =>
      matches
        .filter(
          (match) =>
            match.status === 'scheduled' &&
            (format === 'team'
              ? activeCategory === 'overall' || match.category === activeCategory
              : match.category === activeCategory) &&
            match.scheduled_at &&
            new Date(match.scheduled_at).getTime() >= Date.now() &&
            (ownTeamIds.includes(match.team_one_id || '') ||
              ownTeamIds.includes(match.team_two_id || '') ||
              pairs.some(
                (pair) =>
                  pair.status !== 'withdrawn' &&
                  pair.category === match.category &&
                  (pair.id === match.pair_one_id || pair.id === match.pair_two_id) &&
                  (ownParticipantIds.includes(pair.player_one_id) ||
                    ownParticipantIds.includes(pair.player_two_id)),
              )),
        )
        .sort(
          (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
        )[0],
    [matches, ownTeamIds, ownParticipantIds, pairs, activeCategory, format],
  );

  const enabledPhases = config?.phases ?? {
    round_robin: true,
    preliminary_knockout: false,
    final_knockout: true,
    team_round_robin: true,
    team_knockout: true,
  };
  const visibleMatches = matches.filter(
    (match) =>
      match.status !== 'cancelled' &&
      (match.phase === 'round_robin'
        ? enabledPhases.round_robin !== false
        : match.phase === 'preliminary_knockout'
          ? enabledPhases.preliminary_knockout === true
          : match.phase === 'final_knockout'
            ? enabledPhases.final_knockout !== false
            : match.phase === 'team_round_robin'
              ? enabledPhases.team_round_robin !== false
              : match.phase === 'team_knockout'
                ? enabledPhases.team_knockout !== false
                : false),
  );
  const categoryVisibleMatches = visibleMatches.filter((match) =>
    activeCategory === 'overall' && format === 'team' ? true : match.category === activeCategory,
  );
  const roundRobinRoundByMatch = useMemo(
    () =>
      roundNumbersByMatch(
        categoryVisibleMatches
          .filter(
            (match) =>
              match.phase.includes('round_robin') &&
              match.status !== 'cancelled' &&
              match.status !== 'bye',
          )
          .sort(compareByScheduleThenMatchNumber),
        format === 'team',
      ),
    [categoryVisibleMatches, format],
  );

  return {
    ownNextMatch,
    enabledPhases,
    visibleMatches,
    categoryVisibleMatches,
    roundRobinRoundByMatch,
  };
}
