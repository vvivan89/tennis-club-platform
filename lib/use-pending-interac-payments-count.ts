'use client';

import { useEffect, useState } from 'react';

/** Counts Interac requests awaiting their first administrator review. */
export function usePendingInteracPaymentsCount(enabled: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }

    let active = true;
    let fetching = false;
    let refreshQueued = false;
    const refresh = async () => {
      if (fetching) {
        refreshQueued = true;
        return;
      }
      fetching = true;
      do {
        refreshQueued = false;
        try {
          const response = await fetch('/api/admin/payments/pending-interac-count', {
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('Could not load pending Interac payment count.');
          const result = (await response.json()) as { count?: number };
          if (active) setCount(result.count ?? 0);
        } catch {
          // Keep the last known count if a transient request fails.
        }
      } while (active && refreshQueued);
      fetching = false;
    };
    const refreshSignal = () => void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    void refresh();
    window.addEventListener('pctc-pending-interac-payments-refresh', refreshSignal);
    window.addEventListener('focus', refreshSignal);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener('pctc-pending-interac-payments-refresh', refreshSignal);
      window.removeEventListener('focus', refreshSignal);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
