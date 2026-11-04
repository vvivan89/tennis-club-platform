import type { TournamentConfig } from '@/lib/tournament-config';
import { parseBracketSlots } from '@/lib/tournament-match';
import type { Match, Pair, Participant, Team } from '@/components/tournament-management-types';
import { tournamentGroupCount } from '@/lib/tournament-groups';

export function getTournamentDrawStatus({
  config,
  enabledPhases,
  phases,
  isTeam,
  activeCategory,
  matchCategory = activeCategory,
  matchPhase,
  teams,
  participants,
  pairs,
  matches,
}: {
  config: TournamentConfig | null;
  enabledPhases: Record<string, boolean | undefined>;
  phases: ReadonlyArray<readonly [string, string]>;
  isTeam: boolean;
  activeCategory: string;
  matchCategory?: string;
  matchPhase: string;
  teams: Team[];
  participants: Participant[];
  pairs: Pair[];
  matches: Match[];
}) {
  const teamSizes = teams.map(
    (team) =>
      participants.filter(
        (participant) =>
          participant.team_id === team.id &&
          participant.category === 'team' &&
          participant.status === 'registered',
      ).length,
  );
  const unevenTeams =
    isTeam && teamSizes.length > 1 && Math.max(...teamSizes) - Math.min(...teamSizes) > 1;
  const availableMatchPhases = (
    isTeam
      ? phases.filter(
          ([key]) =>
            key.startsWith('team_') &&
            (key === 'team_round_robin'
              ? enabledPhases.team_round_robin !== false
              : enabledPhases.team_knockout !== false),
        )
      : phases.filter(
          ([key]) =>
            !key.startsWith('team_') &&
            (key !== 'preliminary_knockout' || enabledPhases.preliminary_knockout) &&
            (key !== 'round_robin' || enabledPhases.round_robin) &&
            (key !== 'final_knockout' || enabledPhases.final_knockout),
        )
  ) as ReadonlyArray<readonly [string, string]>;
  const availablePhaseKey = availableMatchPhases.map(([key]) => key).join(',');

  const currentBracketEntrantCount = isTeam
    ? teams.length
    : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory)
        .length;
  const bracketUsesRoundRobinPromotion =
    matchPhase === (isTeam ? 'team_knockout' : 'final_knockout') &&
    (isTeam ? enabledPhases.team_round_robin !== false : enabledPhases.round_robin !== false);
  const bracketGroupCount = tournamentGroupCount(config);
  const assignedGroupCount = new Set(
    (isTeam
      ? teams
      : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory)
    )
      .map((entry) => entry.group_number)
      .filter((group): group is number => group != null),
  ).size;
  const expectedBracketEntrantCount = bracketUsesRoundRobinPromotion
    ? (assignedGroupCount || bracketGroupCount) *
      Math.max(1, Number(config?.promoted_teams_per_group ?? 2))
    : currentBracketEntrantCount || bracketGroupCount;
  const existingKnockoutMatches = matches.filter(
    (match) =>
      match.category === (isTeam ? matchCategory : activeCategory) &&
      match.phase === matchPhase &&
      match.phase.includes('knockout'),
  );
  const existingBracketEntrants = new Set(
    existingKnockoutMatches
      .filter((match) => match.round_number === 1)
      .flatMap((match) => {
        const ids = isTeam
          ? [match.team_one_id, match.team_two_id]
          : [match.pair_one_id, match.pair_two_id];
        const slots = parseBracketSlots(match.notes);
        return ids.map(
          (id, index) =>
            id || (slots[index] && slots[index] !== 'Bye' ? `slot:${slots[index]}` : null),
        );
      })
      .filter((id): id is string => Boolean(id)),
  );
  const bracketNeedsRedraw =
    existingKnockoutMatches.length > 0 &&
    existingBracketEntrants.size !== expectedBracketEntrantCount;
  const knockoutBracketHasResults = existingKnockoutMatches.some(
    (match) =>
      match.status === 'completed' ||
      match.winner_side != null ||
      (match.score_sets?.length ?? 0) > 0,
  );

  return {
    teamSizes,
    unevenTeams,
    availableMatchPhases,
    availablePhaseKey,
    bracketNeedsRedraw,
    knockoutBracketHasResults,
  };
}
