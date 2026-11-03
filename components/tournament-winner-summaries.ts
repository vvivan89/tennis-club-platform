import { knockoutRoundCount, type TournamentConfig } from '@/lib/tournament-config';
import { defaultRankingPriority, tournamentRankingMetric } from '@/lib/tournament-standings';
import type { Match, Pair, Team } from '@/components/tournament-public-view-types';
import type { buildTournamentGroupStandings } from '@/components/tournament-public-group-standings';

export function buildTournamentWinnerSummaries({
  matches,
  teams,
  pairs,
  config,
  format,
  groupStandings,
}: {
  matches: Match[];
  teams: Team[];
  pairs: Pair[];
  config: TournamentConfig | null;
  format: string | null;
  groupStandings: ReturnType<typeof buildTournamentGroupStandings>;
}) {
  const categories =
    format === 'team' ? ['team'] : (config?.categories ?? ['mixed', 'men', 'women']);
  const summaries: Array<{ category: string; winners: string[] }> = [];
  const rankingPriority = config?.ranking_priority ?? defaultRankingPriority(format === 'team');
  for (const category of categories) {
    const phase = format === 'team' ? 'team_knockout' : 'final_knockout';
    const knockoutEnabled = config?.phases?.[phase] !== false;
    const categoryMatches = matches.filter(
      (match) => match.category === category && match.status !== 'cancelled',
    );
    if (knockoutEnabled) {
      const finals = categoryMatches.filter((match) => match.phase === phase);
      if (!finals.length) continue;
      const roundRobinPhase = format === 'team' ? 'team_round_robin' : 'round_robin';
      const roundRobinEnabled = config?.phases?.[roundRobinPhase] !== false;
      const categoryEntries =
        format === 'team'
          ? teams
          : pairs.filter((pair) => pair.category === category && pair.status !== 'withdrawn');
      const entrantCount = roundRobinEnabled
        ? new Set(
            categoryEntries.map((entry) => entry.group_number).filter((group) => group != null),
          ).size * Math.max(1, Number(config?.promoted_teams_per_group ?? 2))
        : categoryEntries.length;
      const expectedFinalRound = knockoutRoundCount(entrantCount);
      const finalMatch = finals.find((match) => match.round_number === expectedFinalRound);
      if (
        !expectedFinalRound ||
        !finalMatch ||
        finalMatch.status !== 'completed' ||
        !finalMatch.winner_side
      )
        continue;
      const winnerId =
        format === 'team'
          ? finalMatch.winner_side === 1
            ? finalMatch.team_one_id
            : finalMatch.team_two_id
          : finalMatch.winner_side === 1
            ? finalMatch.pair_one_id
            : finalMatch.pair_two_id;
      const winner =
        format === 'team'
          ? teams.find((team) => team.id === winnerId)?.name
          : (() => {
              const pair = pairs.find((item) => item.id === winnerId);
              return pair ? `${pair.player_one_name} + ${pair.player_two_name}` : undefined;
            })();
      if (winner) summaries.push({ category, winners: [winner] });
      continue;
    }

    const roundRobinPhase = format === 'team' ? 'team_round_robin' : 'round_robin';
    const scheduled = categoryMatches.filter((match) => match.phase === roundRobinPhase);
    if (
      !scheduled.length ||
      scheduled.some((match) => match.status !== 'completed' || !match.score_sets?.length)
    )
      continue;
    const rows = groupStandings
      .filter((group) => group.category === category)
      .flatMap((group) => group.standings.map((row) => ({ ...row, group: group.group })));
    if (!rows.length) continue;
    const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
      for (const key of rankingPriority) {
        if (key === 'head_to_head') {
          if (a.group !== b.group) continue;
          const direct = categoryMatches.find(
            (match) =>
              match.phase === roundRobinPhase &&
              match.group_number === a.group &&
              match.status === 'completed' &&
              ((format === 'team' && match.team_one_id === a.id && match.team_two_id === b.id) ||
                (format === 'team' && match.team_one_id === b.id && match.team_two_id === a.id) ||
                (format !== 'team' && match.pair_one_id === a.id && match.pair_two_id === b.id) ||
                (format !== 'team' && match.pair_one_id === b.id && match.pair_two_id === a.id)),
          );
          if (direct?.winner_side) {
            const firstId = format === 'team' ? direct.team_one_id : direct.pair_one_id;
            return firstId === a.id
              ? direct.winner_side === 1
                ? -1
                : 1
              : direct.winner_side === 2
                ? -1
                : 1;
          }
          continue;
        }
        const difference = tournamentRankingMetric(b, key) - tournamentRankingMetric(a, key);
        if (difference) return difference;
      }
      return 0;
    };
    const sorted = [...rows].sort(compare);
    const winners = sorted.filter((row) => compare(row, sorted[0]) === 0).map((row) => row.name);
    if (winners.length) summaries.push({ category, winners });
  }
  return summaries;
}
