import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { TournamentPartnerConfirmation } from '@/components/tournament-public-view-types';

export function useTournamentInvitationActions({
  eventId,
  guestAccessEmail,
  partnerConfirmation,
  setGuestAccessBusy,
  setGuestAccessError,
  setGuestAccessMessage,
  setRegistrationMessage,
  setPartnerConfirmation,
  setPartnerConfirmationBusy,
  setPartnerConfirmationError,
  setRegistrationRefresh,
}: {
  eventId: string;
  guestAccessEmail: string;
  partnerConfirmation: TournamentPartnerConfirmation | null;
  setGuestAccessBusy: Dispatch<SetStateAction<boolean>>;
  setGuestAccessError: Dispatch<SetStateAction<string>>;
  setGuestAccessMessage: Dispatch<SetStateAction<string>>;
  setRegistrationMessage: Dispatch<SetStateAction<string>>;
  setPartnerConfirmation: Dispatch<SetStateAction<TournamentPartnerConfirmation | null>>;
  setPartnerConfirmationBusy: Dispatch<SetStateAction<boolean>>;
  setPartnerConfirmationError: Dispatch<SetStateAction<string>>;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
}) {
  async function requestEventGuestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGuestAccessBusy(true);
    setGuestAccessError('');
    setGuestAccessMessage('');
    try {
      const response = await fetch('/api/events/guest-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: guestAccessEmail, eventId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not send the sign-in link.');
      if (result.memberLoginRequired) {
        setGuestAccessMessage('Please log in as a member.');
        return;
      }
      setRegistrationMessage(result.message || 'Check your email for a sign-in link.');
    } catch (error) {
      setGuestAccessError(
        error instanceof Error ? error.message : 'Could not send the sign-in link.',
      );
    } finally {
      setGuestAccessBusy(false);
    }
  }

  async function requestPartnerInvitation(participantId: string) {
    const response = await fetch('/api/events/partner-invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantIds: [participantId] }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(result.error || 'The partner confirmation request could not be sent.');
  }

  async function confirmPartnerParticipation() {
    if (!partnerConfirmation) return;
    setPartnerConfirmationBusy(true);
    setPartnerConfirmationError('');
    try {
      const response = await fetch('/api/events/partner-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: partnerConfirmation.participantId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not confirm this participation.');
      setPartnerConfirmation(null);
      const url = new URL(window.location.href);
      url.searchParams.delete('confirm_partner');
      window.history.replaceState({}, '', url.toString());
      setRegistrationMessage(
        'Your participation is confirmed. The team can now pay the event fee.',
      );
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setPartnerConfirmationError(
        error instanceof Error ? error.message : 'Could not confirm this participation.',
      );
    } finally {
      setPartnerConfirmationBusy(false);
    }
  }

  return { requestEventGuestAccess, requestPartnerInvitation, confirmPartnerParticipation };
}
