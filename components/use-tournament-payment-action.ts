import type { Dispatch, SetStateAction } from 'react';
import type { InteracPaymentNotice } from '@/components/interac-payment-instructions-dialog';
import {
  formatMoney,
  tournamentPaymentActionKey,
} from '@/components/tournament-public-view-format';

export function useTournamentPaymentAction({
  eventId,
  currentUserId,
  paymentParticipantIds,
  newEntryParticipantId,
  newPartnerParticipantId,
  setPaymentBusy,
  setPaymentBusyKey,
  setRegistrationError,
  setRegistrationMessage,
  setInteracRequests,
  setInteracNotice,
}: {
  eventId: string;
  currentUserId: string | null;
  paymentParticipantIds: string[];
  newEntryParticipantId: string | null;
  newPartnerParticipantId: string | null;
  setPaymentBusy: Dispatch<SetStateAction<boolean>>;
  setPaymentBusyKey: Dispatch<SetStateAction<string | null>>;
  setRegistrationError: Dispatch<SetStateAction<string>>;
  setRegistrationMessage: Dispatch<SetStateAction<string>>;
  setInteracRequests: Dispatch<SetStateAction<Record<string, InteracPaymentNotice>>>;
  setInteracNotice: Dispatch<SetStateAction<InteracPaymentNotice | null>>;
}) {
  async function startTournamentPayment(
    participantIds = paymentParticipantIds,
    provider: 'stripe' | 'interac' = 'stripe',
  ) {
    if (!participantIds.length) return;
    setPaymentBusy(true);
    setPaymentBusyKey(tournamentPaymentActionKey(participantIds, provider));
    setRegistrationError('');
    try {
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'tournament_registration',
          provider,
          businessRecordId: [...new Set(participantIds)].sort().join(','),
          returnTo:
            !currentUserId &&
            newEntryParticipantId &&
            newPartnerParticipantId &&
            participantIds.length === 1
              ? `${window.location.pathname}?guest_payment_ids=${encodeURIComponent([newEntryParticipantId, newPartnerParticipantId].join(','))}`
              : `/events/${eventId}`,
          returnLabel: 'Back to tournament',
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not start tournament payment.');
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (provider === 'interac' && result.message) {
        const sortedParticipantIds = [...new Set(participantIds)].sort();
        const amount = formatMoney(Number(result.amountMinor || 0));
        const payerScope = sortedParticipantIds.length > 1 ? 'both partner entries' : 'your entry';
        const notice: InteracPaymentNotice = {
          amount,
          recipientEmail: result.recipientEmail || '',
          paymentId: result.paymentId,
          instructions: result.instructions || '',
          message: `Your Interac request for ${payerScope} (${amount}) is pending club confirmation.`,
        };
        setInteracRequests((current) => ({
          ...current,
          [tournamentPaymentActionKey(sortedParticipantIds, 'interac')]: notice,
        }));
        setInteracNotice(notice);
        setRegistrationMessage(notice.message);
        return;
      }
      throw new Error(
        result.message ||
          'Payment instructions were not returned. Contact the tournament organizer.',
      );
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not start tournament payment.',
      );
    } finally {
      setPaymentBusy(false);
      setPaymentBusyKey(null);
    }
  }

  return { startTournamentPayment };
}
