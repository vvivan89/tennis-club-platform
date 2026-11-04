import type { TournamentConfig } from '@/lib/tournament-config';
import {
  compareTournamentEntries,
  compareTournamentHeadToHead,
  tournamentRankingPriority,
  tournamentRankingMetric,
} from '@/lib/tournament-standings';
import type { GroupOverride, Match, Pair, Team } from '@/components/tournament-public-view-types';
import { effectiveTournamentGroup } from '@/lib/tournament-groups';
import { getTournamentScoringTemplate } from '@/lib/tournament-config';
import { teamMatchPoints } from '@/lib/tournament-score';

type StandingRow = {
  id: string;
  name: string;
  played: number;
  wins: number;
  points: number;
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
  automaticPosition: number;
};

export type GroupStanding = {
  category: string;
  group: number;
  rows: Map<string, Omit<StandingRow, 'automaticPosition'>>;
  standings: StandingRow[];
};

export function aggregateOverallTeamStandings(
  groups: GroupStanding[],
  config: TournamentConfig | null,
  matches: Match[],
): GroupStanding[] {
  const groupsByNumber = new Map<number, Map<string, Omit<StandingRow, 'automaticPosition'>>>();
  for (const group of groups) {
    let rows = groupsByNumber.get(group.group);
    if (!rows) {
      rows = new Map();
      groupsByNumber.set(group.group, rows);
    }
    for (const row of group.rows.values()) {
      const current = rows.get(row.id);
      if (current) {
        current.played += row.played;
        current.wins += row.wins;
        current.points += row.points;
        current.setsFor += row.setsFor;
        current.setsAgainst += row.setsAgainst;
        current.gamesFor += row.gamesFor;
        current.gamesAgainst += row.gamesAgainst;
      } else {
        rows.set(row.id, { ...row });
      }
    }
  }
  const priority = tournamentRankingPriority(config, true);
  return [...groupsByNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([group, rows]) => {
      const sorted = [...rows.values()].sort((a, b) =>
        compareTournamentEntries(
          a,
          b,
          priority,
          tournamentRankingMetric,
          (first, second) => {
            let firstWins = 0;
            let secondWins = 0;
            for (const match of matches) {
              if (
                match.group_number !== group ||
                match.status !== 'completed' ||
                !match.winner_side
              ) {
                continue;
              }
              const firstTeamId = match.team_one_id;
              const secondTeamId = match.team_two_id;
              if (!(
                (firstTeamId === first.id && secondTeamId === second.id) ||
                (firstTeamId === second.id && secondTeamId === first.id)
              )) {
                continue;
              }
              const winnerId = match.winner_side === 1 ? firstTeamId : secondTeamId;
              if (winnerId === first.id) firstWins += 1;
              else if (winnerId === second.id) secondWins += 1;
            }
            return firstWins === secondWins ? null : firstWins > secondWins ? -1 : 1;
          },
          (row) => row.name,
        ),
      );
      return {
        category: 'overall',
        group,
        rows,
        standings: sorted.map((row, index) => ({ ...row, automaticPosition: index + 1 })),
      };
    });
}

export function buildTournamentGroupStandings({
  visibleMatches,
  teams,
  pairs,
  config,
  format,
  groupOverrides,
}: {
  visibleMatches: Match[];
  teams: Team[];
  pairs: Pair[];
  config: TournamentConfig | null;
  format: string | null;
  groupOverrides: GroupOverride[];
}): GroupStanding[] {
  const groups = new Map<
    string,
    {
      category: string;
      group: number;
      rows: Map<string, Omit<StandingRow, 'automaticPosition'>>;
    }
  >();
  const ensureGroup = (category: string, group: number) => {
    const key = `${category}:${group}`;
    if (!groups.has(key)) groups.set(key, { category, group, rows: new Map() });
    return groups.get(key)!;
  };
  const ensureEntry = (category: string, group: number, id: string, name: string) => {
    const rows = ensureGroup(category, group).rows;
    if (!rows.has(id))
      rows.set(id, {
        id,
        name,
        played: 0,
        wins: 0,
        points: 0,
        setsFor: 0,
        setsAgainst: 0,
        gamesFor: 0,
        gamesAgainst: 0,
      });
    return rows.get(id)!;
  };

  if (format === 'team') {
    const teamCategories = (config?.categories ?? ['mixed', 'men', 'women']).filter((category) =>
      ['mixed', 'men', 'women'].includes(category),
    );
    teams.forEach((team) => {
      const group = effectiveTournamentGroup(team.group_number, config);
      if (group)
        teamCategories.forEach((category) => ensureEntry(category, group, team.id, team.name));
    });
  } else {
    pairs
      .filter((pair) => pair.status !== 'withdrawn')
      .forEach((pair) => {
        const group = effectiveTournamentGroup(pair.group_number, config);
        if (group)
          ensureEntry(
            pair.category,
            group,
            pair.id,
            `${pair.player_one_name} + ${pair.player_two_name}`,
          );
      });
  }

  visibleMatches
    .filter(
      (match) =>
        effectiveTournamentGroup(match.group_number, config) &&
        match.status === 'completed' &&
        match.phase.includes('round_robin'),
    )
    .forEach((match) => {
      const firstId = format === 'team' ? match.team_one_id : match.pair_one_id;
      const secondId = format === 'team' ? match.team_two_id : match.pair_two_id;
      const firstName = format === 'team' ? match.team_one_name : match.player_one_name || 'TBD';
      const secondName = format === 'team' ? match.team_two_name : match.opponent_one_name || 'TBD';
      if (!firstId || !secondId) return;
      const group = effectiveTournamentGroup(match.group_number, config)!;
      const one = ensureEntry(match.category, group, firstId, firstName || 'TBD');
      const two = ensureEntry(match.category, group, secondId, secondName || 'TBD');
      one.played++;
      two.played++;
      if (match.winner_side === 1) one.wins++;
      if (match.winner_side === 2) two.wins++;
      if (format === 'team') {
        const points = teamMatchPoints(
          match.score_sets ?? [],
          getTournamentScoringTemplate(config, match.phase),
        );
        one.points += points.pointsOne;
        two.points += points.pointsTwo;
      }
      for (const set of match.score_sets ?? []) {
        one.setsFor += set.one > set.two ? 1 : 0;
        one.setsAgainst += set.two > set.one ? 1 : 0;
        two.setsFor += set.two > set.one ? 1 : 0;
        two.setsAgainst += set.one > set.two ? 1 : 0;
        one.gamesFor += set.one;
        one.gamesAgainst += set.two;
        two.gamesFor += set.two;
        two.gamesAgainst += set.one;
      }
    });

  const priority = tournamentRankingPriority(config, format === 'team');
  return [...groups.values()]
    .sort((a, b) => a.group - b.group || a.category.localeCompare(b.category))
    .map((group) => {
      const standings = [...group.rows.values()].sort((a, b) =>
        compareTournamentEntries(
          a,
          b,
          priority,
          tournamentRankingMetric,
          (first, second) =>
            compareTournamentHeadToHead(
              visibleMatches,
              first.id,
              second.id,
              format === 'team',
              (match) =>
                match.category === group.category &&
                match.group_number === group.group &&
                match.status === 'completed',
            ),
          (row) => row.name,
        ),
      );
      const automaticPositions = new Map(standings.map((row, index) => [row.id, index + 1]));
      const overrides = groupOverrides
        .filter(
          (item) =>
            item.category === group.category &&
            item.group_number === group.group &&
            item.override_type === 'ranking',
        )
        .sort((a, b) => a.override_value - b.override_value);
      for (const override of overrides) {
        const currentIndex = standings.findIndex((row) => row.id === override.entry_id);
        if (currentIndex < 0) continue;
        const [row] = standings.splice(currentIndex, 1);
        standings.splice(
          Math.max(0, Math.min(standings.length, override.override_value - 1)),
          0,
          row,
        );
      }
      return {
        ...group,
        standings: standings.map((row) => ({
          ...row,
          automaticPosition: automaticPositions.get(row.id) ?? 0,
        })),
      };
    });
}
