import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { TournamentPartnerConfirmation } from '@/components/tournament-public-view-types';

export function useTournamentInvitationActions({
  eventId,
  leagueTournament,
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
  leagueTournament: boolean;
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

  async function confirmPartnerParticipation(participantId?: string) {
    const targetParticipantId = participantId || partnerConfirmation?.participantId;
    if (!targetParticipantId) return;
    setPartnerConfirmationBusy(true);
    setPartnerConfirmationError('');
    try {
      const response = await fetch('/api/events/partner-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: targetParticipantId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not confirm this participation.');
      let emailWarning = '';
      if (leagueTournament) {
        try {
          const emailResponse = await fetch('/api/events/league-registration-confirmation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participantId: targetParticipantId }),
          });
          if (!emailResponse.ok)
            emailWarning =
              ' Confirmation emails could not be sent; please contact the event organizer.';
        } catch {
          emailWarning =
            ' Confirmation emails could not be sent; please contact the event organizer.';
        }
      }
      setPartnerConfirmation(null);
      const url = new URL(window.location.href);
      url.searchParams.delete('confirm_partner');
      window.history.replaceState({}, '', url.toString());
      setRegistrationMessage(
        'Your participation is confirmed. The team can now pay the event fee.' + emailWarning,
      );
      window.dispatchEvent(new Event('pctc-tournament-invitation-updated'));
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
