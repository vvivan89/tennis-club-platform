export type RankingPlayer = {
  id: string;
  name: string;
  gender?: 'male' | 'female' | null;
  skillRating: number | null;
  gamesWon: number;
  gamesLost: number;
  setsWon: number;
  setsLost: number;
  gamesPercentage: number;
  setsPercentage: number;
  gamesPlayed: number;
};
export type SeasonSettings = {
  season_start_month: number;
  season_start_day: number;
  season_end_month: number;
  season_end_day: number;
};
export function getSeasonYear(date: Date, settings: SeasonSettings): number {
  const month = date.getMonth() + 1;
  const start = settings.season_start_month;
  const end = settings.season_end_month;
  if (start <= end) return month < start ? date.getFullYear() - 1 : date.getFullYear();
  return month >= start ? date.getFullYear() : date.getFullYear() - 1;
}
export function isInSeason(date: Date, seasonYear: number, settings: SeasonSettings): boolean {
  const start = new Date(
    seasonYear,
    settings.season_start_month - 1,
    settings.season_start_day,
    0,
    0,
    0,
    0,
  );
  const endYear =
    settings.season_end_month < settings.season_start_month ? seasonYear + 1 : seasonYear;
  const end = new Date(
    endYear,
    settings.season_end_month - 1,
    settings.season_end_day,
    23,
    59,
    59,
    999,
  );
  return date >= start && date <= end;
}
export function rankPlayers(players: RankingPlayer[]): RankingPlayer[] {
  return [...players].sort(
    (a, b) =>
      b.gamesPercentage - a.gamesPercentage ||
      b.gamesWon - a.gamesWon ||
      b.gamesPlayed - a.gamesPlayed ||
      a.name.localeCompare(b.name),
  );
}
export function medal(rank: number): string | null {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
}
export type PlayerGameForStats = {
  playerIds: string[];
  sideOneIds: string[];
  sideTwoIds: string[];
  scoreOne: number;
  scoreTwo: number;
};
export function calculatePlayerStats(
  players: Pick<RankingPlayer, 'id' | 'name' | 'skillRating'>[],
  games: PlayerGameForStats[],
): RankingPlayer[] {
  return players.map((player) => {
    let gamesWon = 0,
      gamesLost = 0,
      setsWon = 0,
      setsLost = 0,
      gamesPlayed = 0;
    for (const game of games) {
      if (!game.playerIds.includes(player.id)) continue;
      const onOne = game.sideOneIds.includes(player.id);
      const won = onOne ? game.scoreOne : game.scoreTwo;
      const lost = onOne ? game.scoreTwo : game.scoreOne;
      gamesWon += won;
      gamesLost += lost;
      gamesPlayed++;
      if (won > lost) setsWon++;
      else if (won < lost) setsLost++;
    }
    const totalGames = gamesWon + gamesLost,
      totalSets = setsWon + setsLost;
    return {
      ...player,
      gamesWon,
      gamesLost,
      setsWon,
      setsLost,
      gamesPercentage: totalGames ? (gamesWon / totalGames) * 100 : 0,
      setsPercentage: totalSets ? (setsWon / totalSets) * 100 : 0,
      gamesPlayed,
    };
  });
}
