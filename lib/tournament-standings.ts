export type RankingKey =
  | 'points'
  | 'matches_won'
  | 'sets_won'
  | 'games_won'
  | 'set_difference'
  | 'game_difference'
  | 'head_to_head'
  | string;

export function defaultRankingPriority(isTeam: boolean): RankingKey[] {
  return [
    ...(isTeam ? ['points' as const] : []),
    'matches_won',
    'sets_won',
    'games_won',
    'set_difference',
    'game_difference',
    'head_to_head',
  ];
}

export function tournamentRankingMetric(
  row: {
    points?: number;
    wins?: number;
    setsWon?: number;
    setsFor?: number;
    setsAgainst?: number;
    gamesWon?: number;
    gamesFor?: number;
    gamesAgainst?: number;
    setDiff?: number;
    gameDiff?: number;
  },
  key: RankingKey,
) {
  switch (key) {
    case 'points':
      return row.points ?? 0;
    case 'matches_won':
      return row.wins ?? 0;
    case 'sets_won':
      return row.setsWon ?? row.setsFor ?? 0;
    case 'games_won':
      return row.gamesWon ?? row.gamesFor ?? 0;
    case 'set_difference':
      return row.setDiff ?? (row.setsFor ?? 0) - (row.setsAgainst ?? 0);
    case 'game_difference':
      return row.gameDiff ?? (row.gamesFor ?? 0) - (row.gamesAgainst ?? 0);
    default:
      return 0;
  }
}

type HeadToHeadMatch = {
  team_one_id: string | null;
  team_two_id: string | null;
  pair_one_id: string | null;
  pair_two_id: string | null;
  winner_side: number | null;
};

export function compareTournamentHeadToHead<T extends HeadToHeadMatch>(
  matches: readonly T[],
  firstEntryId: string,
  secondEntryId: string,
  isTeam: boolean,
  isRelevant: (match: T) => boolean = () => true,
) {
  const match = matches.find((candidate) => {
    if (!candidate.winner_side || !isRelevant(candidate)) return false;
    const firstId = isTeam ? candidate.team_one_id : candidate.pair_one_id;
    const secondId = isTeam ? candidate.team_two_id : candidate.pair_two_id;
    return (
      (firstId === firstEntryId && secondId === secondEntryId) ||
      (firstId === secondEntryId && secondId === firstEntryId)
    );
  });
  if (!match?.winner_side) return null;
  const winnerOneId = isTeam ? match.team_one_id : match.pair_one_id;
  const firstWon = winnerOneId === firstEntryId ? match.winner_side === 1 : match.winner_side === 2;
  return firstWon ? -1 : 1;
}

export function compareTournamentEntries<T>(
  a: T,
  b: T,
  priority: readonly RankingKey[],
  metric: (row: T, key: RankingKey) => number,
  headToHead: (first: T, second: T) => number | null,
  name: (row: T) => string,
) {
  for (const key of priority) {
    if (key === 'head_to_head') {
      const result = headToHead(a, b);
      if (result) return result;
      continue;
    }
    const difference = metric(b, key) - metric(a, key);
    if (difference) return difference;
  }
  return name(a).localeCompare(name(b));
}

type StatsMatch = {
  team_one_id: string | null;
  team_two_id: string | null;
  pair_one_id: string | null;
  pair_two_id: string | null;
  winner_side: number | null;
  team_points_one?: number | null;
  team_points_two?: number | null;
  score_sets?: Array<{ one: number; two: number }> | null;
};

type SideStats<T> = {
  side: T;
  wins: number;
  points: number;
  setsWon: number;
  gamesWon: number;
  setDiff: number;
  gameDiff: number;
};

export function createSideStats<T extends { id: string }>(side: T): SideStats<T> {
  return { side, wins: 0, points: 0, setsWon: 0, gamesWon: 0, setDiff: 0, gameDiff: 0 };
}

/** Adds one side's results from the given matches into its running totals. */
export function accumulateSideStats<T extends { id: string }>(
  row: SideStats<T>,
  matches: StatsMatch[],
  isTeam: boolean,
): SideStats<T> {
  const sideId = row.side.id;
  for (const match of matches) {
    const firstId = isTeam ? match.team_one_id : match.pair_one_id;
    const secondId = isTeam ? match.team_two_id : match.pair_two_id;
    if (firstId !== sideId && secondId !== sideId) continue;
    if (
      match.winner_side &&
      ((firstId === sideId && match.winner_side === 1) ||
        (secondId === sideId && match.winner_side === 2))
    )
      row.wins++;
    if (isTeam)
      row.points +=
        firstId === sideId
          ? Number(match.team_points_one ?? 0)
          : Number(match.team_points_two ?? 0);
    for (const set of match.score_sets ?? []) {
      const own = firstId === sideId ? set.one : set.two;
      const against = firstId === sideId ? set.two : set.one;
      row.setsWon += own > against ? 1 : 0;
      row.setDiff += (own > against ? 1 : 0) - (own < against ? 1 : 0);
      row.gamesWon += own;
      row.gameDiff += own - against;
    }
  }
  return row;
}
