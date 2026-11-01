export type SetScore = { one: number; two: number };

export type ScoreEvaluation =
  | { error: string }
  | { error?: undefined; sets: SetScore[]; winner: 1 | 2; pointsOne: number; pointsTwo: number };

const sideWins = (sets: SetScore[]) => ({
  one: sets.filter((s) => s.one > s.two).length,
  two: sets.filter((s) => s.two > s.one).length,
});

/** Parses a "6-4, 3-6, 10-8" string and validates it against a scoring template. */
export function evaluateTournamentScore(raw: string, scoringTemplate?: string): ScoreEvaluation {
  const sets = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split('-').map(Number);
      return { one: parts[0], two: parts[1] };
    });
  if (
    !sets.length ||
    sets.some(
      (s) =>
        !Number.isInteger(s.one) ||
        !Number.isInteger(s.two) ||
        s.one < 0 ||
        s.two < 0 ||
        s.one === s.two,
    )
  )
    return { error: 'Enter decisive set scores like 6-4, 3-6, 10-8.' };
  if (scoringTemplate === 'one_set' && sets.length !== 1)
    return { error: 'This scoring template requires exactly one set.' };
  const wins = sideWins(sets);
  if (scoringTemplate === 'best_of_three' && (sets.length > 3 || Math.max(wins.one, wins.two) < 2))
    return {
      error: 'Best-of-three requires a player to win two sets, with no more than three sets.',
    };
  const badTwoSetsThenThird =
    sets.length < 2 ||
    sets.length > 3 ||
    (sets[0].one > sets[0].two === sets[1].one > sets[1].two && sets.length !== 2) ||
    (sets[0].one > sets[0].two !== sets[1].one > sets[1].two && sets.length !== 3);
  if (scoringTemplate === 'two_sets_then_third' && badTwoSetsThenThird)
    return { error: 'Play two sets; add a deciding third set only when the first two are split.' };
  if (scoringTemplate === 'team_two_sets_bonus_third' && badTwoSetsThenThird)
    return {
      error:
        'This team scoring template requires two sets, plus a third set if the first two are split.',
    };
  if (wins.one === wins.two) return { error: 'The set scores must identify a winner.' };
  const winner = wins.one > wins.two ? 1 : 2;
  let pointsOne = winner === 1 ? 1 : 0;
  let pointsTwo = winner === 2 ? 1 : 0;
  if (scoringTemplate === 'team_two_sets_bonus_third') {
    const firstTwo = sideWins(sets.slice(0, 2));
    if (firstTwo.one === 2) {
      pointsOne = 3;
      pointsTwo = 0;
    } else if (firstTwo.two === 2) {
      pointsOne = 0;
      pointsTwo = 3;
    } else {
      pointsOne = winner === 1 ? 2 : 1;
      pointsTwo = winner === 2 ? 2 : 1;
    }
  }
  return { sets, winner, pointsOne, pointsTwo };
}
