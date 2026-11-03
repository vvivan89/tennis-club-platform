'use client';

import { useCallback, useEffect, useState } from 'react';

export type PendingTournamentInvitation = {
  participantId: string;
  participantName: string;
  eventId: string;
  eventSlug: string | null;
  eventTitle: string;
  startsAt: string;
};

export function usePendingTournamentInvitations(enabled: boolean) {
  const [invitations, setInvitations] = useState<PendingTournamentInvitation[]>([]);
  const refresh = useCallback(async () => {
    if (!enabled) {
      setInvitations([]);
      return;
    }
    try {
      const response = await fetch('/api/events/partner-invitations', { cache: 'no-store' });
      const result = await response.json();
      if (response.ok && Array.isArray(result.invitations)) setInvitations(result.invitations);
    } catch {
      // Keep the last known invitation count; focus and confirmation events retry the lookup.
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pctc-tournament-invitation-updated', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pctc-tournament-invitation-updated', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return invitations;
}
