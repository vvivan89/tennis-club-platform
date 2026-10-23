import { describe, expect, it } from 'vitest';
import {
  calculatePlayerStats,
  getSeasonYear,
  isInSeason,
  rankPlayers,
} from '../../lib/player-rankings';

const season = {
  season_start_month: 4,
  season_start_day: 1,
  season_end_month: 9,
  season_end_day: 30,
};

describe('player rankings helpers', () => {
  it('sorts by games percentage, then wins, games played, and name', () => {
    const players = [
      {
        id: 'b',
        name: 'Bea',
        skillRating: null,
        gamesWon: 6,
        gamesLost: 4,
        setsWon: 1,
        setsLost: 0,
        gamesPercentage: 60,
        setsPercentage: 100,
        gamesPlayed: 1,
      },
      {
        id: 'a',
        name: 'Ada',
        skillRating: null,
        gamesWon: 6,
        gamesLost: 4,
        setsWon: 1,
        setsLost: 0,
        gamesPercentage: 60,
        setsPercentage: 100,
        gamesPlayed: 1,
      },
      {
        id: 'c',
        name: 'Cal',
        skillRating: null,
        gamesWon: 8,
        gamesLost: 2,
        setsWon: 1,
        setsLost: 0,
        gamesPercentage: 80,
        setsPercentage: 100,
        gamesPlayed: 1,
      },
    ];

    expect(rankPlayers(players).map((player) => player.id)).toEqual(['c', 'a', 'b']);
    expect(players[0].id).toBe('b');
  });

  it('assigns the season year across a calendar-year boundary', () => {
    const crossYear = { ...season, season_start_month: 10, season_end_month: 3 };

    expect(getSeasonYear(new Date(2026, 11, 1), crossYear)).toBe(2026);
    expect(getSeasonYear(new Date(2027, 1, 1), crossYear)).toBe(2026);
  });

  it('includes both season boundary dates', () => {
    expect(isInSeason(new Date(2026, 3, 1, 0, 0), 2026, season)).toBe(true);
    expect(isInSeason(new Date(2026, 8, 30, 23, 59), 2026, season)).toBe(true);
    expect(isInSeason(new Date(2026, 9, 1), 2026, season)).toBe(false);
  });

  it('calculates singles stats and skips unrelated games', () => {
    const players = [
      { id: 'p1', name: 'Player One', skillRating: 3.5 },
      { id: 'p2', name: 'Player Two', skillRating: 4 },
    ];
    const games = [
      {
        playerIds: ['p1', 'p2'],
        sideOneIds: ['p1'],
        sideTwoIds: ['p2'],
        scoreOne: 6,
        scoreTwo: 3,
      },
      {
        playerIds: ['p1', 'p2'],
        sideOneIds: ['p1'],
        sideTwoIds: ['p2'],
        scoreOne: 2,
        scoreTwo: 6,
      },
    ];

    const result = calculatePlayerStats(players, games);

    expect(result[0]).toMatchObject({
      gamesWon: 8,
      gamesLost: 9,
      setsWon: 1,
      setsLost: 1,
      gamesPlayed: 2,
    });
    expect(result[1]).toMatchObject({
      gamesWon: 9,
      gamesLost: 8,
      setsWon: 1,
      setsLost: 1,
      gamesPlayed: 2,
    });
  });
});
