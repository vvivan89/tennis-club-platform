import type { Dispatch, SetStateAction } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { TournamentConfig } from '@/lib/tournament-config';
import type { Match } from '@/components/tournament-management-types';
import type { Pair, Participant } from '@/components/tournament-management-types';
import type { TournamentAuditRow } from '@/components/tournament-audit-log';

type Db = ReturnType<typeof createSupabaseBrowserClient>;
type PendingCourtMove = {
  match: Match;
  court: number | null;
  conflicts: Array<{ match: Match; severity: 'danger' | 'warning' }>;
};
type ActionResult = { error: { message: string } | null };

export function useTournamentCourtActions({
  db,
  config,
  matches,
  pendingCourtMove,
  setPendingCourtMove,
  runAction,
}: {
  db: Db;
  config: TournamentConfig | null;
  matches: Match[];
  pendingCourtMove: PendingCourtMove | null;
  setPendingCourtMove: Dispatch<SetStateAction<PendingCourtMove | null>>;
  runAction: (action: () => PromiseLike<ActionResult>, success: string) => Promise<boolean>;
}) {
  async function moveMatchToCourt(match: Match, court: number | null) {
    if (match.court_number === court) return;
    const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000;
    const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15)) * 60000;
    const conflicts: Array<{ match: Match; severity: 'danger' | 'warning' }> = [];
    if (court != null && match.scheduled_at) {
      const start = new Date(match.scheduled_at).getTime();
      const end = start + duration;
      for (const other of matches) {
        if (
          other.id === match.id ||
          other.status === 'cancelled' ||
          !other.scheduled_at ||
          other.court_number !== court
        )
          continue;
        const otherStart = new Date(other.scheduled_at).getTime();
        const otherEnd = otherStart + duration;
        const overlaps = start < otherEnd && otherStart < end;
        const tooCloseAfter = start >= otherEnd && start < otherEnd + gap;
        const tooCloseBefore = otherStart >= end && otherStart < end + gap;
        if (overlaps) conflicts.push({ match: other, severity: 'danger' });
        else if (tooCloseAfter || tooCloseBefore)
          conflicts.push({ match: other, severity: 'warning' });
      }
    }
    if (conflicts.length) {
      setPendingCourtMove({ match, court, conflicts });
      return;
    }
    await runAction(
      () =>
        db
          .from('tournament_matches')
          .update({ court_number: court, updated_at: new Date().toISOString() })
          .eq('id', match.id),
      'Court assignment updated.',
    );
  }

  async function confirmCourtMove() {
    if (!pendingCourtMove) return;
    const { match, court } = pendingCourtMove;
    setPendingCourtMove(null);
    await runAction(
      () =>
        db
          .from('tournament_matches')
          .update({ court_number: court, updated_at: new Date().toISOString() })
          .eq('id', match.id),
      'Court assignment updated. Scheduling conflicts remain and are highlighted below.',
    );
  }

  return { moveMatchToCourt, confirmCourtMove };
}

export function filterTournamentAuditRows({
  auditRows,
  isTeam,
  activeCategory,
  participants,
  pairs,
  matches,
}: {
  auditRows: TournamentAuditRow[];
  isTeam: boolean;
  activeCategory: string;
  participants: Participant[];
  pairs: Pair[];
  matches: Match[];
}) {
  return auditRows.filter((row) => {
    const category = String(row.after_data?.category ?? row.before_data?.category ?? '');
    if (isTeam) return !category || category === 'team';
    if (category) return category === activeCategory;
    if (row.entity_type.includes('participant'))
      return (
        participants.find((participant) => participant.id === row.entity_id)?.category ===
        activeCategory
      );
    if (row.entity_type.includes('pair'))
      return pairs.find((pair) => pair.id === row.entity_id)?.category === activeCategory;
    if (row.entity_type.includes('match'))
      return matches.find((match) => match.id === row.entity_id)?.category === activeCategory;
    return true;
  });
}
