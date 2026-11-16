import { describe, expect, it } from 'vitest';
import { getTournamentRegistrationOptions } from '@/components/tournament-registration-options';
import { buildTournamentGroupStandings } from '@/components/tournament-public-group-standings';
import { buildTournamentWinnerSummaries } from '@/components/tournament-winner-summaries';
import { roundNumbersByMatch } from '@/lib/tournament-match';
import type { Match, Participant } from '@/components/tournament-public-view-types';

const singlesConfig = {
  categories: ['all', 'men', 'women'],
  phases: { round_robin: true, final_knockout: true },
  group_count: 1,
};
const participants: Participant[] = [
  {
    id: 'p1',
    event_id: 'e1',
    user_id: 'u1',
    team_id: null,
    category: 'all',
    display_name: 'Ada',
    gender: 'female',
    status: 'registered',
  },
  {
    id: 'p2',
    event_id: 'e1',
    user_id: 'u2',
    team_id: null,
    category: 'all',
    display_name: 'Bea',
    gender: 'female',
    status: 'registered',
  },
];
const singlesMatch = (overrides: Partial<Match> = {}): Match => ({
  id: 'm1',
  event_id: 'e1',
  category: 'all',
  phase: 'round_robin',
  group_number: 1,
  round_number: 1,
  match_number: 1,
  pair_one_id: null,
  pair_two_id: null,
  team_one_id: null,
  team_two_id: null,
  player_one_participant_id: 'p1',
  player_two_participant_id: 'p2',
  scheduled_at: null,
  court_number: null,
  score_sets: [{ one: 6, two: 3 }],
  winner_side: 1,
  team_points_one: 0,
  team_points_two: 0,
  status: 'completed',
  team_one_name: null,
  team_two_name: null,
  player_one_name: 'Ada',
  player_two_name: null,
  opponent_one_name: 'Bea',
  opponent_two_name: null,
  ...overrides,
});

describe('singles tournament flows', () => {
  it('offers only enabled, gender-eligible singles categories and respects existing entries', () => {
    const options = getTournamentRegistrationOptions({
      config: singlesConfig,
      format: 'singles',
      leagueTournament: false,
      leagueRegistrationCategory: 'all',
      ownCategories: [],
      registrationGender: 'male',
      currentUserId: 'u1',
    });
    expect(options.availableCategories).toEqual(['all', 'men']);
    expect(options.hasGenderEligibleCategory).toBe(true);
    const secondEntry = getTournamentRegistrationOptions({
      config: singlesConfig,
      format: 'singles',
      leagueTournament: false,
      leagueRegistrationCategory: 'all',
      ownCategories: ['all'],
      registrationGender: 'male',
      currentUserId: 'u1',
    });
    expect(secondEntry.availableCategories).toEqual(['men']);
  });

  it('calculates round-robin standings from individual match sides', () => {
    const standings = buildTournamentGroupStandings({
      visibleMatches: [singlesMatch()],
      teams: [],
      pairs: [],
      participants,
      config: singlesConfig,
      format: 'singles',
      groupOverrides: [],
    });
    expect(standings).toHaveLength(1);
    expect(
      standings[0].standings.map(({ id, wins, gamesFor }) => ({ id, wins, gamesFor })),
    ).toEqual([
      { id: 'p1', wins: 1, gamesFor: 6 },
      { id: 'p2', wins: 0, gamesFor: 3 },
    ]);
  });

  it('announces singles winners by participant identity', () => {
    const final = singlesMatch({ phase: 'final_knockout', round_number: 1, winner_side: 2 });
    const winners = buildTournamentWinnerSummaries({
      matches: [final],
      teams: [],
      pairs: [],
      participants,
      config: { ...singlesConfig, phases: { round_robin: false, final_knockout: true } },
      format: 'singles',
      groupStandings: [],
    });
    expect(winners).toEqual([{ category: 'all', winners: ['Bea'] }]);
  });

  it('numbers singles rounds using participant IDs', () => {
    const first = singlesMatch({ id: 'm1', scheduled_at: '2026-11-15T10:00:00Z' });
    const second = singlesMatch({
      id: 'm2',
      scheduled_at: '2026-11-15T11:00:00Z',
    });
    expect(roundNumbersByMatch([first, second], 'singles')).toEqual(
      new Map([
        ['m1', 1],
        ['m2', 2],
      ]),
    );
  });
});
