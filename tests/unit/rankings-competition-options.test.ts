import { describe, expect, it } from 'vitest';
import { buildRankingsCompetitionOptions } from '@/lib/rankings-competition-options';

describe('buildRankingsCompetitionOptions', () => {
  it('deduplicates and sorts seasons, then appends ladder, League, and tournament options', () => {
    expect(
      buildRankingsCompetitionOptions(
        [2025, 2026, 2025],
        [{ id: 'ladder-1', name: 'Spring ladder', gender: 'male' }],
        [
          { id: 'league-1', name: 'Summer League', gender: 'female' },
          { id: 'league-2', name: 'Open League', gender: 'other' },
        ],
        [{ id: 'tournament-1', title: 'Club Open' }],
      ),
    ).toEqual([
      { value: '2026', label: 'Full 2026 season' },
      { value: '2025', label: 'Full 2025 season' },
      { value: 'ladder:ladder-1', label: "Spring ladder (Men's ladder)" },
      { value: 'league:league-1', label: "Summer League (Women's league)" },
      { value: 'league:league-2', label: "Open League (Women's league)" },
      { value: 'tournament:tournament-1', label: 'Club Open (Doubles tournament)' },
    ]);
  });

  it('returns an empty list when no competitions or seasons are available', () => {
    expect(buildRankingsCompetitionOptions([], [], [], [])).toEqual([]);
  });
});
