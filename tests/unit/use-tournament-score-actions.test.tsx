import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTournamentScoreActions } from '@/components/use-tournament-score-actions';
import type { Match } from '@/components/tournament-management-types';

function match(overrides: Record<string, unknown> = {}) {
  return {
    id: 'match-1',
    category: 'open',
    phase: 'final_knockout',
    group_number: null,
    round_number: 1,
    match_number: 1,
    pair_one_id: 'pair-1',
    pair_two_id: 'pair-2',
    team_one_id: 'team-1',
    team_two_id: 'team-2',
    scheduled_at: null,
    court_number: null,
    score_sets: [],
    winner_side: null,
    team_points_one: 0,
    team_points_two: 0,
    status: 'scheduled',
    notes: '',
    ...overrides,
  } as Match;
}

function setup({
  isTeam = false,
  matches = [],
  matchPlayers = [],
  pendingDeleteMatch = null,
  dbError = null,
  saveResult = true,
  runResult = true,
  syncError,
}: {
  isTeam?: boolean;
  matches?: Match[];
  matchPlayers?: Array<{
    match_id: string;
    participant_id: string;
    side: number;
    team_id: string | null;
  }>;
  pendingDeleteMatch?: Match | null;
  dbError?: { message: string } | null;
  saveResult?: boolean;
  runResult?: boolean;
  syncError?: Error;
} = {}) {
  const query = {
    update: vi.fn(() => query),
    delete: vi.fn(() => query),
    insert: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ error: dbError }).then(resolve),
  };
  const db = { from: vi.fn(() => query) } as never;
  const refresh = vi.fn().mockResolvedValue(undefined);
  const runAction = vi.fn(async (action: () => PromiseLike<unknown>) => {
    await action();
    return runResult;
  });
  const saveMatch = vi.fn().mockResolvedValue(saveResult);
  const syncPromotedKnockoutEntrants = vi.fn(async () => {
    if (syncError) throw syncError;
  });
  const setters = {
    setError: vi.fn(),
    setMessage: vi.fn(),
    setPendingDeleteMatch: vi.fn(),
    setPendingWalkoverScore: vi.fn(),
  };
  const { result } = renderHook(() =>
    useTournamentScoreActions({
      db,
      isTeam,
      config: null,
      matches,
      pairs: [
        { id: 'pair-1', player_one_id: 'p1', player_two_id: 'p2' },
        { id: 'pair-2', player_one_id: 'p3', player_two_id: 'p4' },
      ] as never,
      matchPlayers: matchPlayers as never,
      pendingDeleteMatch,
      refresh,
      runAction,
      saveMatch,
      syncPromotedKnockoutEntrants,
      ...setters,
    }),
  );
  return {
    actions: result.current,
    db,
    query,
    refresh,
    runAction,
    saveMatch,
    syncPromotedKnockoutEntrants,
    setters,
  };
}

describe('useTournamentScoreActions', () => {
  it('guards team scoring until both sides have two assigned players', async () => {
    const state = setup({ isTeam: true });
    await act(async () => state.actions.saveScore(match(), '6-4'));
    expect(state.setters.setError).toHaveBeenCalledWith(
      'Assign two players to each team before recording the result so individual records remain accurate.',
    );
    expect(state.saveMatch).not.toHaveBeenCalled();
  });

  it('validates scores, asks before replacing a walkover, and saves a confirmed replacement', async () => {
    const saved = match({ notes: 'Walkover / retirement awarded to side one' });
    const state = setup({ matches: [match({ id: 'next', round_number: 2, match_number: 1 })] });
    await act(async () => state.actions.saveScore(saved, 'not a score'));
    expect(state.setters.setError).toHaveBeenCalled();
    await act(async () => state.actions.saveScore(saved, '6-4'));
    expect(state.setters.setPendingWalkoverScore).toHaveBeenCalledWith({
      match: saved,
      raw: '6-4',
    });
    await act(async () => state.actions.saveScore(saved, '6-4', true));
    expect(state.saveMatch).toHaveBeenCalledWith(
      saved,
      expect.objectContaining({ score_sets: [{ one: 6, two: 4 }], winner_side: 1, notes: '' }),
    );
    expect(state.setters.setMessage).toHaveBeenCalledWith('Match score saved.');
    expect(state.refresh).toHaveBeenCalled();
  });

  it('does not advance a winner for non-knockout, missing next match, missing winner, or failed update', async () => {
    const state = setup();
    const roundRobin = match({ phase: 'round_robin' });
    await act(async () => state.actions.advanceKnockoutWinner(roundRobin, 1));
    await act(async () => state.actions.advanceKnockoutWinner(match(), 1));
    const next = match({ id: 'next', round_number: 2, match_number: 1 });
    const missingWinner = match({ pair_one_id: null });
    const withNext = setup({ matches: [next], dbError: { message: 'write failed' } });
    await act(async () => withNext.actions.advanceKnockoutWinner(missingWinner, 1));
    await act(async () => withNext.actions.advanceKnockoutWinner(match(), 1));
    expect(withNext.setters.setError).toHaveBeenCalledWith(
      'Result saved, but the winner could not be advanced: write failed',
    );
    expect(withNext.refresh).not.toHaveBeenCalled();
  });

  it('records walkovers, sets round-robin scores, and handles runAction failure', async () => {
    const state = setup({ runResult: false });
    await act(async () => state.actions.recordWalkover(match({ phase: 'round_robin' }), 2));
    expect(state.runAction).toHaveBeenCalled();
    expect(state.syncPromotedKnockoutEntrants).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation and ignores absent pending deletion', async () => {
    const state = setup();
    await act(async () => state.actions.confirmDeleteMatch());
    await act(async () => state.actions.deleteMatch(match()));
    expect(state.setters.setPendingDeleteMatch).toHaveBeenCalledWith(match());
    const pending = setup({ pendingDeleteMatch: match() });
    await act(async () => pending.actions.confirmDeleteMatch());
    expect(pending.setters.setPendingDeleteMatch).toHaveBeenCalledWith(null);
    expect(pending.runAction).toHaveBeenCalled();
  });
});
