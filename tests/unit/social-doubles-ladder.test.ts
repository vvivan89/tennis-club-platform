import { describe, expect, it } from 'vitest';
import {
  calculateLadderSession,
  ladderMetricValue,
  rankLadderStandings,
} from '@/lib/social-doubles-ladder';

describe('Social Doubles Ladder session scoring', () => {
  it('awards friendly tie points and skips tied positions', () => {
    const results = calculateLadderSession(
      [
        {
          playerIds: ['a', 'b', 'c', 'd'],
          sideOneIds: ['a', 'b'],
          sideTwoIds: ['c', 'd'],
          scoreOne: 6,
          scoreTwo: 4,
        },
        {
          playerIds: ['a', 'c', 'b', 'd'],
          sideOneIds: ['a', 'c'],
          sideTwoIds: ['b', 'd'],
          scoreOne: 4,
          scoreTwo: 6,
        },
      ],
      { a: 'Alice', b: 'Bob', c: 'Carol', d: 'Diana' },
      ['games_won'],
      [2, 1, -1, -2],
    );
    expect(results.map((x) => x.playerId)).toEqual(['b', 'a', 'd', 'c']);
    expect(results.map((x) => x.points)).toEqual([2, 1, 1, -2]);
  });
  it('uses configured metric priority and alphabetical order after all ties', () => {
    const results = calculateLadderSession(
      [{ playerIds: ['b', 'a'], sideOneIds: ['b'], sideTwoIds: ['a'], scoreOne: 6, scoreTwo: 4 }],
      { a: 'Alice', b: 'Bob' },
      ['games_won'],
    );
    expect(results[0].name).toBe('Bob');
  });

  it('calculates each supported metric and handles tied scores and missing display names', () => {
    const player = { setsWon: 2, setsLost: 1, gamesWon: 15, gamesLost: 11 };
    expect(ladderMetricValue(player, 'sets_won')).toBe(2);
    expect(ladderMetricValue(player, 'games_won')).toBe(15);
    expect(ladderMetricValue(player, 'games_difference')).toBe(4);
    expect(ladderMetricValue(player, 'sets_difference')).toBe(1);

    const rows = calculateLadderSession(
      [
        { playerIds: ['a', 'b'], sideOneIds: ['a'], sideTwoIds: ['b'], scoreOne: 6, scoreTwo: 4 },
        { playerIds: ['a', 'b'], sideOneIds: ['a'], sideTwoIds: ['b'], scoreOne: 4, scoreTwo: 4 },
      ],
      { a: 'Alex' },
      ['sets_won', 'games_difference', 'sets_difference'],
      [3, 2, 1, 0],
    );
    expect(rows.find((row) => row.playerId === 'a')).toMatchObject({
      name: 'Alex',
      setsWon: 1,
      setsLost: 0,
      gamesWon: 10,
      gamesLost: 8,
    });
    expect(rows.find((row) => row.playerId === 'b')).toMatchObject({
      name: 'b',
      setsWon: 0,
      setsLost: 1,
      gamesWon: 8,
      gamesLost: 10,
    });
  });

  it('ranks equal-point players by each priority metric and finally by name', () => {
    const players = [
      { name: 'Zoe', points: 5, setsWon: 1, setsLost: 0, gamesWon: 8, gamesLost: 6 },
      { name: 'Alex', points: 5, setsWon: 1, setsLost: 0, gamesWon: 8, gamesLost: 6 },
      { name: 'Morgan', points: 5, setsWon: 2, setsLost: 0, gamesWon: 8, gamesLost: 6 },
      { name: 'Taylor', points: 6, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0 },
    ];
    expect(rankLadderStandings(players, ['sets_won', 'games_won'])).toEqual([
      players[3],
      players[2],
      players[1],
      players[0],
    ]);
  });
});
