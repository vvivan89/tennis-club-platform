import type { TournamentConfig } from '@/lib/tournament-config';

export function getTournamentRankingColumns(
  config: TournamentConfig | null,
  format: string | null,
) {
  const rankingColumns = (
    config?.ranking_priority ??
    (format === 'team'
      ? [
          'points',
          'matches_won',
          'sets_won',
          'games_won',
          'set_difference',
          'game_difference',
          'head_to_head',
        ]
      : [
          'matches_won',
          'sets_won',
          'games_won',
          'set_difference',
          'game_difference',
          'head_to_head',
        ])
  ).filter((key) =>
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
