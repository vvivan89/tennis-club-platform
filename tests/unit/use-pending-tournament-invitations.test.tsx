import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePendingTournamentInvitations } from '@/components/use-pending-tournament-invitations';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('usePendingTournamentInvitations', () => {
  it('loads invitations and refreshes on focus, app updates, and visible-page changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        invitations: [{ participantId: 'entry-1', eventTitle: 'Summer Open' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePendingTournamentInvitations(true));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/events/partner-invitations', {
      cache: 'no-store',
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pctc-tournament-invitation-updated'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('does not fetch when disabled, clears on disable, and keeps current data on failed refreshes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invitations: [{ participantId: 'entry-1' }] }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ invitations: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ invitations: 'invalid' }) })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ enabled }) => usePendingTournamentInvitations(enabled),
      {
        initialProps: { enabled: true },
      },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toHaveLength(1);

    rerender({ enabled: false });
    await waitFor(() => expect(result.current).toEqual([]));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
