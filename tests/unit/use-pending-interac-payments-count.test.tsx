import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePendingInteracPaymentsCount } from '@/lib/use-pending-interac-payments-count';

describe('usePendingInteracPaymentsCount', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not fetch when disabled, then loads and refreshes when enabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 3 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 4 }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ enabled }) => usePendingInteracPaymentsCount(enabled),
      {
        initialProps: { enabled: false },
      },
    );
    expect(result.current).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toBe(3));
    act(() => window.dispatchEvent(new Event('pctc-pending-interac-payments-refresh')));
    await waitFor(() => expect(result.current).toBe(4));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last count on fetch failures and queues refresh while a request is in flight', async () => {
    let resolveFirst!: (value: { ok: boolean; json: () => Promise<{ count: number }> }) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 2 }) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePendingInteracPaymentsCount(true));
    await waitFor(() => expect(result.current).toBe(2));

    act(() => {
      window.dispatchEvent(new Event('pctc-pending-interac-payments-refresh'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveFirst({ ok: true, json: async () => ({ count: 5 }) });
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(result.current).toBe(5);

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('ignores visibility changes while hidden and returns zero after disabling', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ enabled }) => usePendingInteracPaymentsCount(enabled),
      {
        initialProps: { enabled: true },
      },
    );
    await waitFor(() => expect(result.current).toBe(1));
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(
      document,
      'visibilityState',
      visibility ?? { configurable: true, value: 'visible' },
    );
    rerender({ enabled: false });
    expect(result.current).toBe(0);
  });
});
