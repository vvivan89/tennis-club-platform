import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTournamentPaymentAction } from '@/components/use-tournament-payment-action';

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const setPaymentBusy = vi.fn();
  const setPaymentBusyKey = vi.fn();
  const setRegistrationError = vi.fn();
  const setRegistrationMessage = vi.fn();
  const setInteracRequests = vi.fn();
  const setInteracNotice = vi.fn();
  const { result } = renderHook(() =>
    useTournamentPaymentAction({
      eventId: 'event-1',
      currentUserId: 'user-1',
      paymentParticipantIds: ['p2', 'p1', 'p1'],
      newEntryParticipantId: null,
      newPartnerParticipantId: null,
      setPaymentBusy,
      setPaymentBusyKey,
      setRegistrationError,
      setRegistrationMessage,
      setInteracRequests,
      setInteracNotice,
    }),
  );
  return {
    action: result.current.startTournamentPayment,
    setPaymentBusy,
    setPaymentBusyKey,
    setRegistrationError,
    setRegistrationMessage,
    setInteracRequests,
    setInteracNotice,
  };
}

describe('useTournamentPaymentAction', () => {
  it('skips empty participant lists', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const state = setup();
    await act(async () => state.action([]));
    expect(state.setPaymentBusy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects to a Stripe checkout and clears loading state', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/events/guest-event', assign } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.example/session' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const state = setup();

    await act(async () => state.action());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/payments/checkout',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('p1,p2'),
      }),
    );
    expect(assign).toHaveBeenCalledWith('https://checkout.example/session');
    expect(state.setPaymentBusy).toHaveBeenNthCalledWith(1, true);
    expect(state.setPaymentBusy).toHaveBeenLastCalledWith(false);
    expect(state.setPaymentBusyKey).toHaveBeenLastCalledWith(null);
  });

  it('records an Interac request and notice for the selected entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: 'Request pending',
        amountMinor: 7500,
        recipientEmail: 'payments@example.test',
        paymentId: 'pay-1',
        instructions: 'Send an Interac transfer.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const state = setup();

    await act(async () => state.action(['p2', 'p1'], 'interac'));

    const notice = state.setInteracNotice.mock.calls[0][0];
    expect(notice).toMatchObject({
      amount: '$75.00',
      recipientEmail: 'payments@example.test',
      paymentId: 'pay-1',
      instructions: 'Send an Interac transfer.',
      message:
        'Your Interac request for both partner entries ($75.00) is pending club confirmation.',
    });
    expect(state.setInteracRequests).toHaveBeenCalled();
    expect(state.setRegistrationMessage).toHaveBeenCalledWith(notice.message);
  });

  it('reports API and missing-instructions errors, including invalid JSON fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Payment disabled' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => {
            throw new Error('bad json');
          },
        }),
    );
    const state = setup();

    await act(async () => state.action());
    expect(state.setRegistrationError).toHaveBeenLastCalledWith('Payment disabled');
    await act(async () => state.action(['p1'], 'interac'));
    expect(state.setRegistrationError).toHaveBeenLastCalledWith(
      'Payment instructions were not returned. Contact the tournament organizer.',
    );
    await act(async () => state.action());
    expect(state.setRegistrationError).toHaveBeenLastCalledWith(
      'Could not start tournament payment.',
    );
    expect(state.setPaymentBusy).toHaveBeenLastCalledWith(false);
  });
});
