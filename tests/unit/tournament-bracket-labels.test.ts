import { describe, expect, it } from 'vitest';
import { createTournamentBracketLabels } from '@/components/tournament-bracket-labels';
import type { Match } from '@/components/tournament-public-view-types';

const makeMatch = (overrides: Partial<Match> = {}): Match =>
  ({
    id: 'm1',
    category: 'open',
    phase: 'knockout',
    group_number: null,
    round_number: 1,
    match_number: 1,
    pair_one_id: null,
    pair_two_id: null,
    team_one_id: null,
    team_two_id: null,
    scheduled_at: null,
    court_number: null,
    score_sets: [],
    winner_side: null,
    team_points_one: 0,
    team_points_two: 0,
    status: 'scheduled',
    notes: '',
    ...overrides,
  }) as Match;

describe('createTournamentBracketLabels', () => {
  it('labels standard rounds and resolves configured team and pair entries', () => {
    const teamMatch = makeMatch({
      team_one_id: 't1',
      team_one_name: 'Saved team',
    } as Partial<Match>);
    const pairMatch = makeMatch({
      pair_one_id: 'p1',
      player_one_name: 'Saved player',
    } as Partial<Match>);
    const teamLabels = createTournamentBracketLabels({
      format: 'team',
      knockoutMatches: [],
      teams: [{ id: 't1', name: 'Aces' } as never],
      pairs: [],
    });
    const pairLabels = createTournamentBracketLabels({
      format: 'individual',
      knockoutMatches: [],
      teams: [],
      pairs: [{ id: 'p1', player_one_name: 'Alex', player_two_name: 'Sam' } as never],
    });

    expect(teamLabels.stageLabel('knockout', 2, 3)).toBe('Semifinal');
    expect(teamLabels.sideLabel(teamMatch, 1, 3)).toBe('Aces');
    expect(pairLabels.sideLabel(pairMatch, 1, 3)).toBe('Alex + Sam');
  });

  it('uses saved slots, bye state, prior winners, and safe fallbacks', () => {
    const labels = createTournamentBracketLabels({
      format: 'individual',
      teams: [],
      pairs: [{ id: 'winner-pair', player_one_name: 'Alex', player_two_name: 'Sam' } as never],
      knockoutMatches: [
        makeMatch({
          id: 'previous',
          round_number: 1,
          match_number: 1,
          winner_side: 2,
          pair_two_id: 'winner-pair',
        }),
      ],
    });
    const teamLabels = createTournamentBracketLabels({
      format: 'team',
      teams: [],
      pairs: [],
      knockoutMatches: [],
    });

    expect(labels.sideLabel(makeMatch({ notes: '{"slot_one":"Group 2 Team 1"}' }), 1, 1)).toBe(
      'Group 2 Team 1',
    );
    expect(labels.sideLabel(makeMatch({ notes: '{"slot_one":"bye"}' }), 1, 1)).toBe('BYE');
    expect(labels.sideLabel(makeMatch({ status: 'bye', winner_side: 1 }), 2, 1)).toBe('BYE');
    expect(labels.sideLabel(makeMatch({ status: 'bye' }), 1, 1)).toBe('TBD');
    expect(labels.sideLabel(makeMatch({ notes: 'old free-form note' }), 1, 1)).toBe('TBD');
    expect(labels.sideLabel(makeMatch({ round_number: 2, match_number: 1 }), 1, 3)).toBe(
      'Alex + Sam',
    );
    expect(
      teamLabels.sideLabel(makeMatch({ team_one_id: 'missing', team_one_name: 'Cached' }), 1, 1),
    ).toBe('Cached');
  });
});
