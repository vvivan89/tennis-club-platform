import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTournamentDrawActions } from '@/components/use-tournament-draw-actions';

type Response = { data?: unknown[]; error?: { message: string } | null };
function setup({
  isTeam = true,
  teams = [],
  pairs = [],
  matches = [],
  enabledPhases = {},
  matchPhase = 'team_knockout',
  responses = {},
}: {
  isTeam?: boolean;
  teams?: unknown[];
  pairs?: unknown[];
  matches?: unknown[];
  enabledPhases?: Record<string, boolean | undefined>;
  matchPhase?: string;
  responses?: Record<string, Record<string, Response>>;
} = {}) {
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
  const db = {
    from: (table: string) => {
      const state = { operation: 'select' };
      const query: Record<string, unknown> = {
        select: (...args: unknown[]) => {
          calls.push({ table, operation: 'select', args });
          state.operation = 'select';
          return query;
        },
        update: (...args: unknown[]) => {
          calls.push({ table, operation: 'update', args });
          state.operation = 'update';
          return query;
        },
        insert: (...args: unknown[]) => {
          calls.push({ table, operation: 'insert', args });
          state.operation = 'insert';
          return query;
        },
        delete: (...args: unknown[]) => {
          calls.push({ table, operation: 'delete', args });
          state.operation = 'delete';
          return query;
        },
        eq: (...args: unknown[]) => {
          calls.push({ table, operation: 'eq', args });
          return query;
        },
        neq: (...args: unknown[]) => {
          calls.push({ table, operation: 'neq', args });
          return query;
        },
        in: (...args: unknown[]) => {
          calls.push({ table, operation: 'in', args });
          return query;
        },
        then: (resolve: (value: Response) => unknown) =>
          Promise.resolve(responses[table]?.[state.operation] ?? { data: [], error: null }).then(
            resolve,
          ),
      };
      return query;
    },
  } as never;
  const setters = {
    setBusy: vi.fn(),
    setError: vi.fn(),
    setMessage: vi.fn(),
    setPendingDeleteMatch: vi.fn(),
    setPendingWalkoverScore: vi.fn(),
  };
  const refresh = vi.fn().mockResolvedValue(undefined);
  const insertMatchPlayers = vi.fn().mockResolvedValue(undefined);
  const saveMatch = vi.fn().mockResolvedValue(true);
  const runAction = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() =>
    useTournamentDrawActions({
      db,
      eventId: 'event-1',
      eventStartsAt: '2026-11-03T10:00:00Z',
      eventEndsAt: null,
      courtCount: 2,
      activeCategory: 'open',
      isTeam,
      matchCategory: 'team',
      matchPhase,
      config: { group_count: 2 } as never,
      enabledPhases,
      scheduleTimings: { duration: 60, breakMinutes: 10 },
      teams: teams as never,
      pairs: pairs as never,
      matches: matches as never,
      matchPlayers: [],
      pendingDeleteMatch: null,
      refresh,
      insertMatchPlayers,
      saveMatch,
      runAction,
      ...setters,
    }),
  );
  return {
    actions: result.current,
    calls,
    setters,
    refresh,
    insertMatchPlayers,
    saveMatch,
    runAction,
  };
}

describe('useTournamentDrawActions', () => {
  it('stops round-robin synchronization when the entry query fails', async () => {
    const state = setup({
      responses: { tournament_teams: { select: { error: { message: 'read failed' } } } },
    });
    await expect(state.actions.syncUnplayedRoundRobinMatches()).resolves.toEqual({
      error: { message: 'read failed' },
    });
    expect(state.calls.filter(({ table }) => table === 'tournament_matches')).toHaveLength(0);
  });

  it('randomizes teams, reconciles matches, refreshes, and reports update errors', async () => {
    const successful = setup({
      teams: [{ id: 't1' }, { id: 't2' }],
      responses: {
        tournament_teams: {
          select: {
            data: [
              { id: 't1', group_number: 1 },
              { id: 't2', group_number: 2 },
            ],
          },
        },
      },
    });
    await act(async () => successful.actions.randomizeGroups());
    expect(
      successful.calls.filter(
        ({ table, operation }) => table === 'tournament_teams' && operation === 'update',
      ),
    ).toHaveLength(2);
    expect(successful.setters.setMessage).toHaveBeenCalledWith(
      expect.stringContaining('Random draw assigned'),
    );
    expect(successful.refresh).toHaveBeenCalled();
    expect(successful.setters.setBusy).toHaveBeenLastCalledWith(false);

    const failed = setup({
      teams: [{ id: 't1' }],
      responses: { tournament_teams: { update: { error: { message: 'write failed' } } } },
    });
    await act(async () => failed.actions.randomizeGroups());
    expect(failed.setters.setError).toHaveBeenCalledWith('write failed');
    expect(failed.setters.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('rejects knockout generation when results exist or entries lack group assignments', async () => {
    const completed = setup({
      matches: [{ category: 'team', phase: 'team_knockout', status: 'completed' }],
    });
    await act(async () => completed.actions.randomizeKnockoutDraw());
    expect(completed.setters.setError).toHaveBeenCalledWith(
      'The knockout bracket cannot be regenerated because match results exist. Edit the bracket manually instead.',
    );

    const ungrouped = setup({
      teams: [
        { id: 't1', group_number: null },
        { id: 't2', group_number: 1 },
      ],
    });
    await act(async () => ungrouped.actions.randomizeKnockoutDraw());
    expect(ungrouped.setters.setError).toHaveBeenCalledWith(
      'Assign every team or pair to a group before generating the knockout draw.',
    );
  });

  it('skips promotion syncing when disabled or empty and propagates round-robin query errors', async () => {
    const disabled = setup({ teams: [{ id: 't1' }], enabledPhases: { team_round_robin: false } });
    await act(async () => disabled.actions.syncPromotedKnockoutEntrants());
    expect(disabled.calls).toHaveLength(0);

    const empty = setup({ teams: [] });
    await act(async () => empty.actions.syncPromotedKnockoutEntrants());
    expect(empty.calls).toHaveLength(0);

    const failed = setup({
      teams: [{ id: 't1', group_number: 1 }],
      responses: { tournament_matches: { select: { error: { message: 'matches unavailable' } } } },
    });
    await expect(failed.actions.syncPromotedKnockoutEntrants()).rejects.toThrow(
      'matches unavailable',
    );
  });

  it('creates a placeholder bracket when round-robin qualification is disabled and there are no teams', async () => {
    const state = setup({
      matchPhase: 'team_preliminary_knockout',
      teams: [],
      enabledPhases: { team_round_robin: false },
    });
    await act(async () => state.actions.randomizeKnockoutDraw());
    expect(
      state.calls.some(
        ({ table, operation }) => table === 'tournament_matches' && operation === 'insert',
      ),
    ).toBe(true);
    expect(state.setters.setMessage).toHaveBeenCalledWith(expect.stringContaining('Created a'));
    expect(state.refresh).toHaveBeenCalled();
    expect(state.setters.setBusy).toHaveBeenLastCalledWith(false);
  });
});
