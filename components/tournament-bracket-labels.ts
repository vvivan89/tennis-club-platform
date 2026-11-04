import { knockoutStageLabel } from '@/lib/tournament-config';
import type { Match, Pair, Team } from '@/components/tournament-public-view-types';

export function createTournamentBracketLabels({
  format,
  knockoutMatches,
  teams,
  pairs,
  singleGroup = false,
}: {
  format: string | null;
  knockoutMatches: Match[];
  teams: Team[];
  pairs: Pair[];
  singleGroup?: boolean;
}) {
  const stageLabel = (_phase: string, round: number, maxRound: number) =>
    knockoutStageLabel(round, Math.max(1, maxRound));

  const sideLabel = (match: Match, side: 1 | 2, maxRound: number): string => {
    const id =
      format === 'team'
        ? side === 1
          ? match.team_one_id
          : match.team_two_id
        : side === 1
          ? match.pair_one_id
          : match.pair_two_id;
    if (id) {
      if (format === 'team')
        return (
          teams.find((team) => team.id === id)?.name ||
          (side === 1 ? match.team_one_name : match.team_two_name) ||
          'TBD'
        );
      const pair = pairs.find((item) => item.id === id);
      return pair
        ? `${pair.player_one_name} + ${pair.player_two_name}`
        : (side === 1 ? match.player_one_name : match.opponent_one_name) || 'TBD';
    }

    let savedSlotLabel: string | null = null;
    try {
      const notes = JSON.parse(match.notes || '{}') as {
        slot_one?: string | null;
        slot_two?: string | null;
      };
      savedSlotLabel = side === 1 ? (notes.slot_one ?? null) : (notes.slot_two ?? null);
    } catch {
      // Older matches may have free-form notes rather than slot metadata.
    }
    if (savedSlotLabel?.toLowerCase() === 'bye') return 'BYE';
    if (savedSlotLabel && /^Group \d+ Team \d+$/.test(savedSlotLabel))
      return singleGroup ? savedSlotLabel.replace(/^Group \d+ /, '') : savedSlotLabel;
    if (match.status === 'bye' && match.winner_side && side !== match.winner_side) return 'BYE';
    if (match.status === 'bye' && !match.winner_side) return 'TBD';
    if (match.round_number > 1) {
      const previousRound = match.round_number - 1;
      const previousMatchNumber = (match.match_number - 1) * 2 + side;
      const previousLabel = stageLabel(match.phase, previousRound, maxRound);
      const previous = knockoutMatches.find(
        (item) =>
          item.phase === match.phase &&
          item.round_number === previousRound &&
          item.match_number === previousMatchNumber,
      );
      if (previous?.winner_side) {
        const previousId =
          format === 'team'
            ? previous.winner_side === 1
              ? previous.team_one_id
              : previous.team_two_id
            : previous.winner_side === 1
              ? previous.pair_one_id
              : previous.pair_two_id;
        if (previousId) {
          if (format === 'team')
            return (
              teams.find((team) => team.id === previousId)?.name ||
              `Winner of ${previousLabel} ${previousMatchNumber}`
            );
          const pair = pairs.find((item) => item.id === previousId);
          return pair
            ? `${pair.player_one_name} + ${pair.player_two_name}`
            : `Winner of ${previousLabel} ${previousMatchNumber}`;
        }
      }
      return `Winner of ${previousLabel} ${previousMatchNumber}`;
    }
    try {
      const note = JSON.parse(match.notes || '{}') as {
        slot_one?: string | null;
        slot_two?: string | null;
      };
      return (side === 1 ? note.slot_one : note.slot_two) || 'TBD';
    } catch {
      return 'TBD';
    }
  };

  return { stageLabel, sideLabel };
}
