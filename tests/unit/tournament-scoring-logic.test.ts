import { describe, expect, it } from 'vitest';
import { evaluateTournamentScore } from '@/lib/tournament-score';
import {
  accumulateSideStats,
  compareTournamentEntries,
  compareTournamentHeadToHead,
  createSideStats,
  defaultRankingPriority,
  tournamentRankingMetric,
} from '@/lib/tournament-standings';

describe('tournament score evaluation', () => {
  it.each(['', '6-6', 'x-4', '6-abc', '6-4,3-3'])(
    'rejects malformed or indecisive score %j',
    (raw) => {
      expect(evaluateTournamentScore(raw)).toHaveProperty('error');
    },
  );

  it('validates a single-set format and returns winner and points', () => {
    expect(evaluateTournamentScore('6-4', 'one_set')).toEqual({
      sets: [{ one: 6, two: 4 }],
      winner: 1,
      pointsOne: 1,
      pointsTwo: 0,
    });
    expect(evaluateTournamentScore('6-4, 6-2', 'one_set')).toMatchObject({
      error: expect.any(String),
    });
  });

  it('validates best-of-three results, including length and required two-set wins', () => {
    expect(evaluateTournamentScore('6-4, 4-6', 'best_of_three')).toHaveProperty('error');
    expect(evaluateTournamentScore('6-4, 4-6, 7-5, 6-1', 'best_of_three')).toHaveProperty('error');
    expect(evaluateTournamentScore('6-4, 4-6, 7-5', 'best_of_three')).toMatchObject({ winner: 1 });
  });

  it('requires a split before a deciding set for two-set formats', () => {
    expect(evaluateTournamentScore('6-4', 'two_sets_then_third')).toHaveProperty('error');
    expect(evaluateTournamentScore('6-4, 6-4, 10-8', 'two_sets_then_third')).toHaveProperty(
      'error',
    );
    expect(evaluateTournamentScore('6-4, 4-6, 10-8', 'two_sets_then_third')).toMatchObject({
      winner: 1,
    });
    expect(evaluateTournamentScore('6-4, 6-4', 'two_sets_then_third')).toMatchObject({ winner: 1 });
    expect(evaluateTournamentScore('6-4', 'team_two_sets_bonus_third')).toHaveProperty('error');
  });

  it('awards bonus team points for sweeps and for a split followed by the decider', () => {
    expect(evaluateTournamentScore('6-4, 6-2', 'team_two_sets_bonus_third')).toMatchObject({
      pointsOne: 3,
      pointsTwo: 0,
    });
    expect(evaluateTournamentScore('4-6, 2-6', 'team_two_sets_bonus_third')).toMatchObject({
      pointsOne: 0,
      pointsTwo: 3,
    });
    expect(evaluateTournamentScore('6-4, 4-6, 8-10', 'team_two_sets_bonus_third')).toMatchObject({
      winner: 2,
      pointsOne: 1,
      pointsTwo: 2,
    });
    expect(evaluateTournamentScore('6-4, 4-6')).toHaveProperty('error');
  });
});

describe('tournament standings calculations', () => {
  it('uses different default tie-break priority for individual and team standings', () => {
    expect(defaultRankingPriority(false)).not.toContain('points');
    expect(defaultRankingPriority(true)[0]).toBe('points');
  });

  it('resolves every supported metric and uses score-derived differences as fallbacks', () => {
    const row = {
      points: 4,
      wins: 3,
      setsWon: 2,
      setsFor: 8,
      setsAgainst: 5,
      gamesWon: 20,
      gamesFor: 30,
      gamesAgainst: 24,
    };
    expect(tournamentRankingMetric(row, 'points')).toBe(4);
    expect(tournamentRankingMetric(row, 'matches_won')).toBe(3);
    expect(tournamentRankingMetric(row, 'sets_won')).toBe(2);
    expect(tournamentRankingMetric(row, 'games_won')).toBe(20);
    expect(tournamentRankingMetric(row, 'set_difference')).toBe(3);
    expect(tournamentRankingMetric(row, 'game_difference')).toBe(6);
    expect(tournamentRankingMetric({}, 'points')).toBe(0);
    expect(tournamentRankingMetric({ setsFor: 3 }, 'sets_won')).toBe(3);
    expect(tournamentRankingMetric({ gamesFor: 7 }, 'games_won')).toBe(7);
    expect(tournamentRankingMetric({ setsFor: 3, setsAgainst: 4 }, 'set_difference')).toBe(-1);
    expect(tournamentRankingMetric({ gamesFor: 7, gamesAgainst: 5 }, 'game_difference')).toBe(2);
    expect(tournamentRankingMetric(row, 'unknown')).toBe(0);
  });

  it('compares individual and team head-to-head matches in either stored order', () => {
    const matches = [
      {
        team_one_id: 'team-b',
        team_two_id: 'team-a',
        pair_one_id: 'pair-a',
        pair_two_id: 'pair-b',
        winner_side: 1,
      },
    ];
    expect(compareTournamentHeadToHead(matches, 'team-a', 'team-b', true)).toBe(1);
    expect(compareTournamentHeadToHead(matches, 'pair-a', 'pair-b', false)).toBe(-1);
    expect(compareTournamentHeadToHead(matches, 'team-a', 'team-b', true, () => false)).toBeNull();
    expect(
      compareTournamentHeadToHead([{ ...matches[0], winner_side: null }], 'team-a', 'team-b', true),
    ).toBeNull();
  });

  it('compares priority metrics, falls through unresolved head-to-head, then sorts by name', () => {
    const priority = ['points', 'head_to_head', 'matches_won'];
    const a = { name: 'Alex', points: 2, wins: 1 };
    const b = { name: 'Jordan', points: 2, wins: 2 };
    const metric = (row: typeof a, key: string) => (key === 'points' ? row.points : row.wins);
    expect(
      compareTournamentEntries(
        a,
        b,
        priority,
        metric,
        () => 1,
        (row) => row.name,
      ),
    ).toBe(1);
    expect(
      compareTournamentEntries(
        a,
        b,
        priority,
        metric,
        () => null,
        (row) => row.name,
      ),
    ).toBe(1);
    expect(
      compareTournamentEntries(
        a,
        { ...b, wins: 1 },
        priority,
        metric,
        () => 0,
        (row) => row.name,
      ),
    ).toBe(-1);
  });

  it('accumulates player statistics, skips unrelated matches, and adds team points', () => {
    const player = createSideStats({ id: 'player-a' });
    const matches = [
      {
        team_one_id: 'team-a',
        team_two_id: 'team-b',
        pair_one_id: 'player-a',
        pair_two_id: 'player-b',
        winner_side: 1,
        team_points_one: 3,
        team_points_two: 0,
        score_sets: [
          { one: 6, two: 4 },
          { one: 4, two: 6 },
          { one: 10, two: 8 },
        ],
      },
      {
        team_one_id: 'team-c',
        team_two_id: 'team-d',
        pair_one_id: 'other-a',
        pair_two_id: 'other-b',
        winner_side: 2,
        score_sets: [{ one: 2, two: 6 }],
      },
      {
        team_one_id: 'team-b',
        team_two_id: 'team-a',
        pair_one_id: 'player-b',
        pair_two_id: 'player-a',
        winner_side: 1,
        team_points_one: null,
        team_points_two: 2,
        score_sets: null,
      },
    ];
    expect(accumulateSideStats(player, matches, false)).toMatchObject({
      wins: 1,
      points: 0,
      setsWon: 2,
      gamesWon: 20,
      setDiff: 1,
      gameDiff: 2,
    });
    expect(accumulateSideStats(createSideStats({ id: 'team-a' }), matches, true)).toMatchObject({
      wins: 1,
      points: 5,
      setsWon: 2,
    });
  });
});
