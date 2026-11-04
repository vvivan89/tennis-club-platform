import type { TournamentConfig } from '@/lib/tournament-config';

export function tournamentGroupCount(config: TournamentConfig | null | undefined): number {
  return Math.max(1, Number(config?.group_count ?? 2));
}

export function hasSingleTournamentGroup(config: TournamentConfig | null | undefined): boolean {
  return tournamentGroupCount(config) === 1;
}

export function effectiveTournamentGroup(
  groupNumber: number | null | undefined,
  config: TournamentConfig | null | undefined,
): number | null {
  return hasSingleTournamentGroup(config) ? 1 : (groupNumber ?? null);
}
