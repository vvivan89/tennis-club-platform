import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { TournamentConfig } from '@/lib/tournament-config';

type EventFormLadder = {
  id: string;
  name: string;
  gender: string;
  ends_at: string | null;
  position_points: number[];
  ranking_priority: string[];
  competition_type?: string;
  tournament_config?: TournamentConfig | null;
  tournament_rules_html?: string | null;
};

export function useEventFormLadders() {
  const [availableLadders, setAvailableLadders] = useState<EventFormLadder[]>([]);
  useEffect(() => {
    const db = createSupabaseBrowserClient();
    void db
      .from('social_doubles_ladders')
      .select(
        'id,name,gender,ends_at,position_points,ranking_priority,competition_type,tournament_config,tournament_rules_html',
      )
      .order('ends_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => setAvailableLadders((data ?? []) as EventFormLadder[]));
  }, []);
  return availableLadders;
}
