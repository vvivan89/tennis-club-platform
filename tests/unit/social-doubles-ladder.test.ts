import { describe, expect, it } from 'vitest';
import { calculateLadderSession } from '@/lib/social-doubles-ladder';

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
});
