export type LadderMetric = 'sets_won' | 'games_won' | 'games_difference' | 'sets_difference';
export type LadderPlayerResult = {
  playerId: string;
  name: string;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  points: number;
  position: number;
};
export type LadderScore = {
  playerIds: string[];
  sideOneIds: string[];
  sideTwoIds: string[];
  scoreOne: number;
  scoreTwo: number;
};
export function ladderMetricValue(
  player: Pick<LadderPlayerResult, 'setsWon' | 'setsLost' | 'gamesWon' | 'gamesLost'>,
  metric: LadderMetric,
): number {
  if (metric === 'sets_won') return player.setsWon;
  if (metric === 'games_won') return player.gamesWon;
  if (metric === 'games_difference') return player.gamesWon - player.gamesLost;
  return player.setsWon - player.setsLost;
}
export function calculateLadderSession(
  scores: LadderScore[],
  names: Record<string, string>,
  priority: LadderMetric[],
  pointsByPosition: [number, number, number, number] = [2, 1, -1, -2],
): LadderPlayerResult[] {
  const stats = new Map<string, LadderPlayerResult>();
  const get = (id: string) => {
    let result = stats.get(id);
    if (!result) {
      result = {
        playerId: id,
        name: names[id] ?? id,
        setsWon: 0,
        setsLost: 0,
        gamesWon: 0,
        gamesLost: 0,
        points: 0,
        position: 0,
      };
      stats.set(id, result);
    }
    return result;
  };
  for (const score of scores) {
    for (const id of score.playerIds) {
      const player = get(id);
      const onOne = score.sideOneIds.includes(id);
      const won = onOne ? score.scoreOne : score.scoreTwo;
      const lost = onOne ? score.scoreTwo : score.scoreOne;
      player.gamesWon += won;
      player.gamesLost += lost;
      if (won > lost) player.setsWon += 1;
      else if (won < lost) player.setsLost += 1;
    }
  }
  const compare = (a: LadderPlayerResult, b: LadderPlayerResult) => {
    for (const metric of priority) {
      const delta = ladderMetricValue(b, metric) - ladderMetricValue(a, metric);
      if (delta) return delta;
    }
    return a.name.localeCompare(b.name);
  };
  const ordered = [...stats.values()].sort(compare);
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (
      end < ordered.length &&
      priority.every(
        (metric) =>
          ladderMetricValue(ordered[index], metric) === ladderMetricValue(ordered[end], metric),
      )
    )
      end++;
    const tiedPoints = pointsByPosition[Math.min(index, 3)];
    for (let i = index; i < end; i++) {
      ordered[i].position = index + 1;
      ordered[i].points = tiedPoints;
    }
    index = end;
  }
  return ordered;
}
export function rankLadderStandings<
  T extends {
    name: string;
    points: number;
    setsWon: number;
    setsLost: number;
    gamesWon: number;
    gamesLost: number;
  },
>(players: T[], priority: LadderMetric[]): T[] {
  return [...players].sort(
    (a, b) =>
      b.points - a.points ||
      priority.reduce(
        (delta, metric) => delta || ladderMetricValue(b, metric) - ladderMetricValue(a, metric),
        0,
      ) ||
      a.name.localeCompare(b.name),
  );
}
