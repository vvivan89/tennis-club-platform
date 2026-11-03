import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function useTournamentPublicViewSubscriptions({
  db,
  eventId,
  setActiveCategory,
  setRegistrationRefresh,
  refreshPage,
}: {
  db: SupabaseClient;
  eventId: string;
  setActiveCategory: Dispatch<SetStateAction<string>>;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
  refreshPage: () => void;
}) {
  useEffect(() => {
    const channel = db
      .channel(`tournament-public-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        refreshPage,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_teams',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_participants',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_pairs',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_event_court_assignments',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_matches',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_match_players' },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .subscribe();
    const syncCategory = (event: Event) => {
      const detail = (event as CustomEvent<{ category?: string }>).detail;
      if (detail?.category) setActiveCategory(detail.category);
    };
    const refreshTournamentData = (event: Event) => {
      const detail = (event as CustomEvent<{ eventId?: string }>).detail;
      if (!detail?.eventId || detail.eventId === eventId)
        setRegistrationRefresh((value) => value + 1);
    };
    window.addEventListener('pctc-tournament-category-change', syncCategory);
    window.addEventListener('pctc-tournament-data-refresh', refreshTournamentData);
    return () => {
      window.removeEventListener('pctc-tournament-category-change', syncCategory);
      window.removeEventListener('pctc-tournament-data-refresh', refreshTournamentData);
      void db.removeChannel(channel);
    };
  }, [db, eventId, setActiveCategory, setRegistrationRefresh, refreshPage]);
}
