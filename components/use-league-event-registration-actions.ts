import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function useLeagueEventRegistrationActions({
  db,
  eventId,
  currentUserId,
  ownLeagueTeamId,
  priceCents,
  setRegistrationBusy,
  setRegistrationError,
  setRegistrationMessage,
  setNewEntryParticipantId,
  setNewPartnerParticipantId,
  setPaymentParticipantIds,
  setRegistrationRefresh,
}: {
  db: SupabaseClient;
  eventId: string;
  currentUserId: string | null;
  ownLeagueTeamId: string | null;
  priceCents: number;
  setRegistrationBusy: Dispatch<SetStateAction<boolean>>;
  setRegistrationError: Dispatch<SetStateAction<string>>;
  setRegistrationMessage: Dispatch<SetStateAction<string>>;
  setNewEntryParticipantId: Dispatch<SetStateAction<string | null>>;
  setNewPartnerParticipantId: Dispatch<SetStateAction<string | null>>;
  setPaymentParticipantIds: Dispatch<SetStateAction<string[]>>;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
}) {
  async function registerLeagueTeam() {
    if (!ownLeagueTeamId || !currentUserId) return;
    setRegistrationBusy(true);
    setRegistrationError('');
    setRegistrationMessage('');
    try {
      const { data, error } = await db.rpc('register_league_event_team', {
        p_event_id: eventId,
        p_member_id: currentUserId,
      });
      if (error) throw new Error(error.message);
      const result = data as {
        participantId?: string;
        partnerParticipantId?: string;
        amountCents?: number;
      };
      const amountDue = (result.amountCents ?? priceCents) > 0;
      setRegistrationMessage(
        amountDue
          ? 'Your team is registered. Payment is pending; you can pay for both players together.'
          : 'Your team is registered.',
      );
      setNewEntryParticipantId(result.participantId ?? null);
      setNewPartnerParticipantId(result.partnerParticipantId ?? null);
      setPaymentParticipantIds(
        amountDue && result.participantId && result.partnerParticipantId
          ? [result.participantId, result.partnerParticipantId]
          : [],
      );
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not register your League team.',
      );
    } finally {
      setRegistrationBusy(false);
    }
  }

  async function registerLeagueSingle() {
    if (!currentUserId) return;
    setRegistrationBusy(true);
    setRegistrationError('');
    setRegistrationMessage('');
    try {
      const { data, error } = await db.rpc('register_league_single_event_entry', {
        p_event_id: eventId,
      });
      if (error) throw new Error(error.message);
      const result = data as { participantId?: string; amountCents?: number };
      const amountDue = (result.amountCents ?? priceCents) > 0;
      setRegistrationMessage(
        amountDue
          ? 'You are registered as a single player. Payment is pending.'
          : 'You are registered as a single player. An organizer can pair you with a League team.',
      );
      setNewEntryParticipantId(result.participantId ?? null);
      setPaymentParticipantIds(amountDue && result.participantId ? [result.participantId] : []);
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not register for this League event.',
      );
    } finally {
      setRegistrationBusy(false);
    }
  }

  return { registerLeagueTeam, registerLeagueSingle };
}
