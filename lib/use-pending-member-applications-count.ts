'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

let subscriptionId = 0;

export function usePendingMemberApplicationsCount(enabled: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }

    let active = true;
    let fetching = false;
    let refreshQueued = false;
    const db = createSupabaseBrowserClient();
    const refresh = async () => {
      if (fetching) {
        refreshQueued = true;
        return;
      }
      fetching = true;
      do {
        refreshQueued = false;
        const { count: pendingCount, error } = await db
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('application_status', 'pending')
          .eq('account_kind', 'member');
        if (active && !error) setCount(pendingCount ?? 0);
      } while (active && refreshQueued);
      fetching = false;
    };

    const channel = db
      .channel(`pending-member-applications-count-${++subscriptionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        void refresh();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refresh();
      });

    void refresh();
    return () => {
      active = false;
      void db.removeChannel(channel);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
