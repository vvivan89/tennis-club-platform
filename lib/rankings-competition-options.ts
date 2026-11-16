export type RankingsSeasonOptionInput = { id: string; name: string; gender: string };
export type RankingsTournamentOptionInput = { id: string; title: string };
export type RankingsCompetitionOption = { value: string; label: string };

const competitionGenderLabel = (gender: string, type: 'ladder' | 'league') =>
  gender === 'mixed' ? `Mixed ${type}` : `${gender === 'male' ? "Men's" : "Women's"} ${type}`;

export function buildRankingsCompetitionOptions(
  years: number[],
  regularLadders: RankingsSeasonOptionInput[],
  leagues: RankingsSeasonOptionInput[],
  tournaments: RankingsTournamentOptionInput[],
): RankingsCompetitionOption[] {
  return [
    ...[...new Set(years)]
      .sort((a, b) => b - a)
      .map((year) => ({ value: String(year), label: `Full ${year} season` })),
    ...regularLadders.map((ladder) => ({
      value: `ladder:${ladder.id}`,
      label: `${ladder.name} (${competitionGenderLabel(ladder.gender, 'ladder')})`,
    })),
    ...leagues.map((league) => ({
      value: `league:${league.id}`,
      label: `${league.name} (${competitionGenderLabel(league.gender, 'league')})`,
    })),
    ...tournaments.map((tournament) => ({
      value: `tournament:${tournament.id}`,
      label: `${tournament.title} (Doubles tournament)`,
    })),
  ];
}
