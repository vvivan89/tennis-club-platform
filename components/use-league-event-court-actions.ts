import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { LeagueCourtAssignment } from '@/components/league-court-assignment-dialog';
import type { Pair } from '@/components/tournament-public-view-types';

export function useLeagueEventCourtActions({
  db,
  eventId,
  courtCount,
  leaguePairs,
  leagueCourtAssignments,
  setLeagueCourtAssignments,
  setRegistrationRefresh,
  refreshPage,
}: {
  db: ReturnType<typeof createSupabaseBrowserClient>;
  eventId: string;
  courtCount: number;
  leaguePairs: Pair[];
  leagueCourtAssignments: LeagueCourtAssignment[];
  setLeagueCourtAssignments: Dispatch<SetStateAction<LeagueCourtAssignment[]>>;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
  refreshPage: () => void;
}) {
  const [leagueCourtModalOpen, setLeagueCourtModalOpen] = useState(false);
  const [leagueCourtSaving, setLeagueCourtSaving] = useState(false);
  const [leagueCourtDraft, setLeagueCourtDraft] = useState<LeagueCourtAssignment[]>([]);
  const [leagueCourtSessionCount, setLeagueCourtSessionCount] = useState(1);
  const [leagueCourtError, setLeagueCourtError] = useState('');
  const [leagueCourtConfirmation, setLeagueCourtConfirmation] = useState(false);
  const courtTotal = Math.max(1, Math.floor(courtCount));
  const courtCounts = leagueCourtDraft.reduce((counts, assignment) => {
    const key = `${assignment.segment_order}:${assignment.court_number}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const leagueCourtWarnings = [...courtCounts.entries()]
    .filter(([, count]) => count > 2)
    .map(([key, count]) => {
      const [session, court] = key.split(':').map(Number);
      return { session, court, count };
    });

  function openLeagueCourtModal() {
    setLeagueCourtDraft(leagueCourtAssignments.map((assignment) => ({ ...assignment })));
    setLeagueCourtSessionCount(
      Math.max(1, ...leagueCourtAssignments.map((assignment) => assignment.segment_order)),
    );
    setLeagueCourtError('');
    setLeagueCourtModalOpen(true);
  }

  function moveLeaguePairToCourt(pairId: string, court: number, session: number) {
    setLeagueCourtDraft((current) => {
      const retained = current.filter(
        (assignment) => assignment.pair_id !== pairId || assignment.segment_order !== session,
      );
      return [...retained, { pair_id: pairId, court_number: court, segment_order: session }];
    });
    setLeagueCourtError('');
  }

  function unassignLeaguePair(pairId: string, session: number) {
    setLeagueCourtDraft((current) =>
      current.filter(
        (assignment) => assignment.pair_id !== pairId || assignment.segment_order !== session,
      ),
    );
  }

  async function saveLeagueCourtAssignments(skipWarnings = false) {
    const incomplete = Array.from(
      { length: leagueCourtSessionCount },
      (_, index) => index + 1,
    ).some((session) =>
      leaguePairs.some(
        (pair) =>
          leagueCourtDraft.filter(
            (assignment) => assignment.pair_id === pair.id && assignment.segment_order === session,
          ).length !== 1,
      ),
    );
    if (incomplete) {
      setLeagueCourtError('Assign every League team once in each sub-session.');
      return;
    }
    if (leagueCourtWarnings.length && !skipWarnings) {
      setLeagueCourtConfirmation(true);
      return;
    }
    setLeagueCourtSaving(true);
    setLeagueCourtError('');
    const { error } = await db.rpc('save_league_event_court_assignments', {
      p_event_id: eventId,
      p_assignments: leagueCourtDraft,
    });
    if (error) {
      setLeagueCourtError(error.message);
      setLeagueCourtSaving(false);
      return;
    }
    setLeagueCourtAssignments(leagueCourtDraft);
    setRegistrationRefresh((value) => value + 1);
    setLeagueCourtModalOpen(false);
    setLeagueCourtSaving(false);
    refreshPage();
  }

  return {
    leagueCourtModalOpen,
    setLeagueCourtModalOpen,
    leagueCourtSaving,
    leagueCourtDraft,
    setLeagueCourtDraft,
    leagueCourtSessionCount,
    setLeagueCourtSessionCount,
    leagueCourtError,
    leagueCourtConfirmation,
    setLeagueCourtConfirmation,
    setLeagueCourtSaving,
    courtTotal,
    leagueCourtWarnings,
    openLeagueCourtModal,
    moveLeaguePairToCourt,
    unassignLeaguePair,
    saveLeagueCourtAssignments,
  };
}
