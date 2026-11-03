import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OwnTournamentEntry } from '@/components/tournament-public-view-types';
import { categoryLabel } from '@/components/tournament-public-view-format';

type LeagueWithdrawTarget = { participantId: string; partnerParticipantId: string };

export function useTournamentWithdrawalActions({
  db,
  ownEntries,
  withdrawTarget,
  leagueWithdrawTarget,
  setWithdrawTarget,
  setWithdrawBusy,
  setWithdrawError,
  setLeagueWithdrawTarget,
  setLeagueWithdrawBusy,
  setLeagueWithdrawError,
  setRegistrationMessage,
  setRegistrationRefresh,
}: {
  db: SupabaseClient;
  ownEntries: OwnTournamentEntry[];
  withdrawTarget: string | null;
  leagueWithdrawTarget: LeagueWithdrawTarget | null;
  setWithdrawTarget: Dispatch<SetStateAction<string | null>>;
  setWithdrawBusy: Dispatch<SetStateAction<boolean>>;
  setWithdrawError: Dispatch<SetStateAction<string>>;
  setLeagueWithdrawTarget: Dispatch<SetStateAction<LeagueWithdrawTarget | null>>;
  setLeagueWithdrawBusy: Dispatch<SetStateAction<boolean>>;
  setLeagueWithdrawError: Dispatch<SetStateAction<string>>;
  setRegistrationMessage: Dispatch<SetStateAction<string>>;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
}) {
  async function confirmLeagueTeamWithdrawal() {
    if (!leagueWithdrawTarget) return;
    setLeagueWithdrawBusy(true);
    setLeagueWithdrawError('');
    try {
      const response = await fetch('/api/payments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantIds: [
            leagueWithdrawTarget.participantId,
            leagueWithdrawTarget.partnerParticipantId,
          ],
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || 'Could not safely cancel the pending team payment.');
      const { error } = await db.rpc('withdraw_league_event_team', {
        p_participant_id: leagueWithdrawTarget.participantId,
      });
      if (error) throw new Error(error.message);
      setLeagueWithdrawTarget(null);
      setRegistrationMessage('You and your League partner have been withdrawn from this event.');
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setLeagueWithdrawError(
        error instanceof Error ? error.message : 'Could not withdraw your League team.',
      );
    } finally {
      setLeagueWithdrawBusy(false);
    }
  }

  async function confirmTournamentWithdrawal() {
    const entry = ownEntries.find((candidate) => candidate.id === withdrawTarget);
    if (!entry) return;
    setWithdrawBusy(true);
    setWithdrawError('');
    try {
      const response = await fetch('/api/payments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: entry.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || 'Could not safely cancel the pending payment.');
      const { error } = await db.rpc('withdraw_tournament_entry', { p_participant_id: entry.id });
      if (error) throw new Error(error.message);
      setWithdrawTarget(null);
      setRegistrationMessage(
        entry.confirmation_status === 'confirmed' &&
          entry.payment_status === 'paid' &&
          entry.partner_confirmation_status === 'confirmed'
          ? 'The whole team has been withdrawn. Contact the organizer about any refund.'
          : `${categoryLabel(entry.category)} registration withdrawn.`,
      );
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setWithdrawError(
        error instanceof Error ? error.message : 'Could not withdraw this registration.',
      );
    } finally {
      setWithdrawBusy(false);
    }
  }

  return { confirmLeagueTeamWithdrawal, confirmTournamentWithdrawal };
}
