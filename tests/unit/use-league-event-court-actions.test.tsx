import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLeagueEventCourtActions } from '@/components/use-league-event-court-actions';
import type { Pair } from '@/components/tournament-public-view-types';

const pair = { id: 'pair-1' } as Pair;

function setup(rpcResult: { error: { message: string } | null } = { error: null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const setAssignments = vi.fn();
  const setRefresh = vi.fn();
  const refreshPage = vi.fn();
  const db = { rpc } as never;
  const hook = renderHook(() =>
    useLeagueEventCourtActions({
      db,
      eventId: 'event-1',
      courtCount: 6,
      leaguePairs: [pair],
      leagueCourtAssignments: [{ pair_id: 'pair-1', court_number: 2, segment_order: 1 }],
      setLeagueCourtAssignments: setAssignments,
      setRegistrationRefresh: setRefresh,
      refreshPage,
    }),
  );
  return { ...hook, rpc, setAssignments, setRefresh, refreshPage };
}

describe('useLeagueEventCourtActions', () => {
  it('opens from saved assignments, moves and unassigns teams, and bounds court count', () => {
    const { result } = setup();
    expect(result.current.courtTotal).toBe(4);
    act(() => result.current.openLeagueCourtModal());
    expect(result.current.leagueCourtModalOpen).toBe(true);
    expect(result.current.leagueCourtDraft).toEqual([
      { pair_id: 'pair-1', court_number: 2, segment_order: 1 },
    ]);
    act(() => result.current.moveLeaguePairToCourt('pair-1', 3, 1));
    expect(result.current.leagueCourtDraft).toEqual([
      { pair_id: 'pair-1', court_number: 3, segment_order: 1 },
    ]);
    act(() => result.current.unassignLeaguePair('pair-1', 1));
    expect(result.current.leagueCourtDraft).toEqual([]);
    expect(result.current.leagueCourtError).toBe('');
  });

  it('requires every team in every selected session before saving', async () => {
    const { result, rpc } = setup();
    await act(async () => result.current.saveLeagueCourtAssignments());
    expect(result.current.leagueCourtError).toBe(
      'Assign every League team once in each sub-session.',
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires confirmation for overfull courts, then saves successfully when confirmed', async () => {
    const { result, rpc, setAssignments, setRefresh, refreshPage } = setup();
    const overfull = Array.from({ length: 3 }, (_, index) => ({
      pair_id: `pair-${index}`,
      court_number: 1,
      segment_order: 1,
    }));
    act(() => {
      result.current.setLeagueCourtSessionCount(1);
      result.current.setLeagueCourtDraft(overfull);
    });
    expect(result.current.leagueCourtWarnings).toEqual([{ session: 1, court: 1, count: 3 }]);
    await act(async () => result.current.saveLeagueCourtAssignments());
    expect(result.current.leagueCourtConfirmation).toBe(true);
    expect(rpc).not.toHaveBeenCalled();

    await act(async () => result.current.saveLeagueCourtAssignments(true));
    expect(rpc).toHaveBeenCalledWith('save_league_event_court_assignments', {
      p_event_id: 'event-1',
      p_assignments: overfull,
    });
    expect(setAssignments).toHaveBeenCalledWith(overfull);
    expect(setRefresh).toHaveBeenCalled();
    expect(refreshPage).toHaveBeenCalled();
    expect(result.current.leagueCourtModalOpen).toBe(false);
    expect(result.current.leagueCourtSaving).toBe(false);
  });

  it('keeps the dialog open and reports RPC errors', async () => {
    const { result } = setup({ error: { message: 'Database rejected assignment' } });
    act(() => {
      result.current.setLeagueCourtDraft([
        { pair_id: 'pair-1', court_number: 1, segment_order: 1 },
      ]);
    });
    await act(async () => result.current.saveLeagueCourtAssignments());
    expect(result.current.leagueCourtError).toBe('Database rejected assignment');
    expect(result.current.leagueCourtModalOpen).toBe(false);
    expect(result.current.leagueCourtSaving).toBe(false);
  });
});
