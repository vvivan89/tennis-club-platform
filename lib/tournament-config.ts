export type TournamentPhaseSettings = Partial<
  Record<
    | 'round_robin'
    | 'preliminary_knockout'
    | 'final_knockout'
    | 'team_round_robin'
    | 'team_knockout',
    boolean
  >
>;

export type TournamentConfig = {
  categories?: string[];
  show_overall_results?: boolean;
  phases?: TournamentPhaseSettings;
  group_count?: number;
  teams_per_group?: number;
  promoted_teams_per_group?: number;
  registration_mode?: string;
  ranking_priority?: string[];
  schedule?: {
    match_minutes?: number;
    break_minutes?: number;
  };
  scoring_template?: string;
  scoring_templates?: Partial<
    Record<
      | 'round_robin'
      | 'preliminary_knockout'
      | 'final_knockout'
      | 'team_round_robin'
      | 'team_knockout',
      string
    >
  >;
  total_capacity?: number | null;
  category_capacities?: Partial<Record<'mixed' | 'men' | 'women', number | null>>;
};

export type TournamentScoringPhase = keyof NonNullable<TournamentConfig['scoring_templates']>;

export function getTournamentScoringTemplate(config: TournamentConfig | null, phase: string) {
  const phaseTemplate = config?.scoring_templates?.[phase as TournamentScoringPhase];
  return phaseTemplate ?? config?.scoring_template ?? 'best_of_three';
}

export function usesTeamStandingsPoints(config: TournamentConfig | null) {
  return (
    config?.phases?.team_round_robin !== false &&
    getTournamentScoringTemplate(config, 'team_round_robin') === 'team_two_sets_bonus_third'
  );
}

export function normalizeTournamentGender(gender: string | null | undefined) {
  const normalized = gender?.trim().toLowerCase();
  if (['male', 'man', 'men', 'm'].includes(normalized ?? '')) return 'male';
  if (['female', 'woman', 'women', 'f'].includes(normalized ?? '')) return 'female';
  return null;
}

export function isPlayerEligibleForTeamMatch(category: string, gender: string | null | undefined) {
  const normalized = normalizeTournamentGender(gender);
  if (category === 'mixed') return normalized !== null;
  if (category === 'men') return normalized === 'male';
  if (category === 'women') return normalized === 'female';
  return false;
}

export function teamMatchGenderIneligibilityReason(
  category: string,
  gender: string | null | undefined,
) {
  const normalized = normalizeTournamentGender(gender);
  if (!normalized) return 'Gender is not specified. Set a tournament gender override first.';
  if (category === 'men' && normalized !== 'male') return "Men's matches require male players.";
  if (category === 'women' && normalized !== 'female')
    return "Women's matches require female players.";
  return null;
}

/** Move one ranking criterion to a new position while preserving the other priorities. */
export function reorderRankingPriority(
  priorities: string[],
  source: string,
  targetIndex: number,
): string[] {
  const from = priorities.indexOf(source);
  if (from < 0 || !Number.isInteger(targetIndex)) return [...priorities];
  const next = [...priorities];
  next.splice(from, 1);
  const destination = Math.max(0, Math.min(targetIndex, next.length));
  next.splice(destination, 0, source);
  return next;
}

/** Infer the conventional name of a knockout round from its position in the bracket. */
export function knockoutStageLabel(roundNumber: number, totalRounds: number): string {
  if (roundNumber >= totalRounds) return 'Final';
  const entrants = 2 ** (totalRounds - roundNumber + 1);
  if (entrants === 4) return 'Semifinal';
  if (entrants === 8) return 'Quarterfinal';
  if (entrants === 16) return 'Round of 16';
  if (entrants === 32) return 'Round of 32';
  return `Round ${roundNumber}`;
}

/** Infer the bracket depth needed for an entrant count, including non-power-of-two fields. */
export function knockoutRoundCount(entrants: number): number {
  if (!Number.isFinite(entrants) || entrants <= 1) return 0;
  return Math.ceil(Math.log2(entrants));
}

/** A match is considered to have a result if it has a winner, score, or completed status. */
export function matchHasResult(match: {
  status?: string | null;
  winner_side?: number | null;
  score_sets?: unknown[] | null;
}): boolean {
  return (
    match.status === 'completed' || match.winner_side != null || (match.score_sets?.length ?? 0) > 0
  );
}

/** Only a known opposing gender is excluded from men's or women's doubles. */
export function isGenderEligibleForCategory(
  category: string,
  gender: string | null | undefined,
): boolean {
  const normalizedGender = gender?.trim().toLowerCase();
  if (!normalizedGender) return true;
  const canonicalGender =
    normalizedGender === 'm' ||
    normalizedGender === 'man' ||
    normalizedGender === 'men' ||
    normalizedGender === 'male'
      ? 'male'
      : normalizedGender === 'f' ||
          normalizedGender === 'woman' ||
          normalizedGender === 'women' ||
          normalizedGender === 'female'
        ? 'female'
        : null;
  if (category === 'men') return canonicalGender !== 'female';
  if (category === 'women') return canonicalGender !== 'male';
  if (category === 'mixed')
    return canonicalGender === null || canonicalGender === 'male' || canonicalGender === 'female';
  return true;
}
