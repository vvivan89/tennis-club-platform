import type { TournamentConfig } from '@/lib/tournament-config';
import { tournamentRankingPriority } from '@/lib/tournament-standings';

export function getTournamentRankingColumns(
  config: TournamentConfig | null,
  format: string | null,
) {
  const rankingColumns = tournamentRankingPriority(config, format === 'team').filter((key) =>
    [
      'points',
      'matches_won',
      'sets_won',
      'games_won',
      'set_difference',
      'game_difference',
    ].includes(key),
  );
  const rankingColumnLabel: Record<string, string> = {
    points: 'Points',
    matches_won: 'Won',
    sets_won: 'Sets won',
    games_won: 'Games won',
    set_difference: 'Set diff.',
    game_difference: 'Game diff.',
  };
  return { rankingColumns, rankingColumnLabel };
}
