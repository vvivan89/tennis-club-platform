import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTournamentWithdrawalActions } from '@/components/use-tournament-withdrawal-actions';

afterEach(() => vi.unstubAllGlobals());

function setup(
  options: {
    ownEntries?: unknown[];
    leagueTarget?: unknown;
    withdrawTarget?: string | null;
    rpcError?: unknown;
  } = {},
) {
  const rpc = vi.fn().mockResolvedValue({ error: options.rpcError ?? null });
  const setters = {
    setWithdrawTarget: vi.fn(),
    setWithdrawBusy: vi.fn(),
    setWithdrawError: vi.fn(),
    setLeagueWithdrawTarget: vi.fn(),
    setLeagueWithdrawBusy: vi.fn(),
    setLeagueWithdrawError: vi.fn(),
    setRegistrationMessage: vi.fn(),
    setRegistrationRefresh: vi.fn(),
  };
  const { result } = renderHook(() =>
    useTournamentWithdrawalActions({
      db: { rpc } as never,
      ownEntries: (options.ownEntries ?? []) as never,
      withdrawTarget: options.withdrawTarget ?? null,
      leagueWithdrawTarget: (options.leagueTarget ?? null) as never,
      ...setters,
    }),
  );
  return { actions: result.current, rpc, setters };
}

describe('useTournamentWithdrawalActions', () => {
  it('does nothing when there is no selected registration', async () => {
    const state = setup();
    await act(async () => {
      await state.actions.confirmLeagueTeamWithdrawal();
      await state.actions.confirmTournamentWithdrawal();
    });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.setters.setLeagueWithdrawBusy).not.toHaveBeenCalled();
    expect(state.setters.setWithdrawBusy).not.toHaveBeenCalled();
  });

  it('withdraws both League players atomically and refreshes registration state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const state = setup({ leagueTarget: { participantId: 'p1', partnerParticipantId: 'p2' } });
    await act(async () => state.actions.confirmLeagueTeamWithdrawal());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/payments/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ participantIds: ['p1', 'p2'] }),
      }),
    );
    expect(state.rpc).toHaveBeenCalledWith('withdraw_league_event_team', {
      p_participant_id: 'p1',
    });
    expect(state.setters.setLeagueWithdrawTarget).toHaveBeenCalledWith(null);
    expect(state.setters.setRegistrationMessage).toHaveBeenCalledWith(
      'You and your League partner have been withdrawn from this event.',
    );
    expect(state.setters.setRegistrationRefresh).toHaveBeenCalled();
    expect(state.setters.setLeagueWithdrawBusy).toHaveBeenLastCalledWith(false);
  });

  it('reports League cancellation and RPC failures and always clears busy state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Payment cancellation failed' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const failedRpc = setup({
      leagueTarget: { participantId: 'p1', partnerParticipantId: 'p2' },
      rpcError: { message: 'Withdrawal denied' },
    });
    await act(async () => failedRpc.actions.confirmLeagueTeamWithdrawal());
    expect(failedRpc.setters.setLeagueWithdrawError).toHaveBeenCalledWith(
      'Payment cancellation failed',
    );
    expect(failedRpc.setters.setLeagueWithdrawBusy).toHaveBeenLastCalledWith(false);

    const rpcFailure = setup({
      leagueTarget: { participantId: 'p1', partnerParticipantId: 'p2' },
      rpcError: { message: 'Withdrawal denied' },
    });
    await act(async () => rpcFailure.actions.confirmLeagueTeamWithdrawal());
    expect(rpcFailure.setters.setLeagueWithdrawError).toHaveBeenCalledWith('Withdrawal denied');
  });

  it('withdraws a paid confirmed team and uses the team refund message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const entry = {
      id: 'entry-1',
      category: 'open',
      confirmation_status: 'confirmed',
      payment_status: 'paid',
      partner_confirmation_status: 'confirmed',
    };
    const state = setup({ ownEntries: [entry], withdrawTarget: 'entry-1' });
    await act(async () => state.actions.confirmTournamentWithdrawal());
    expect(state.rpc).toHaveBeenCalledWith('withdraw_tournament_entry', {
      p_participant_id: 'entry-1',
    });
    expect(state.setters.setRegistrationMessage).toHaveBeenCalledWith(
      'The whole team has been withdrawn. Contact the organizer about any refund.',
    );
    expect(state.setters.setWithdrawTarget).toHaveBeenCalledWith(null);
  });

  it('uses category-specific messages for unpaid entries and reports database errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const state = setup({
      ownEntries: [{ id: 'entry-2', category: 'women', confirmation_status: 'pending' }],
      withdrawTarget: 'entry-2',
      rpcError: { message: 'Unable to withdraw' },
    });
    await act(async () => state.actions.confirmTournamentWithdrawal());
    expect(state.setters.setWithdrawError).toHaveBeenCalledWith('Unable to withdraw');
    expect(state.setters.setWithdrawBusy).toHaveBeenLastCalledWith(false);
  });
});
