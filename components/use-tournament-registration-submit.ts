import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isGenderEligibleForCategory } from '@/lib/tournament-config';
import type { Participant, PartnerMember } from '@/components/tournament-public-view-types';
import { categoryLabel } from '@/components/tournament-public-view-format';

export function useTournamentRegistrationSubmit({
  db,
  eventId,
  currentUserEmail,
  currentUserId,
  isEventGuest,
  leagueTournament,
  leagueRegistrationCategory,
  registrationCategory,
  effectiveRegistrationMode,
  entrantName,
  entrantEmail,
  entrantPhone,
  entrantGender,
  entrantSkillLevel,
  partnerChoice,
  partnerName,
  partnerEmail,
  partnerPhone,
  partnerGender,
  partnerSkillLevel,
  profileGender,
  partnerMembers,
  participants,
  priceCents,
  requestPartnerInvitation,
  setRegistrationBusy,
  setRegistrationError,
  setRegistrationMessage,
  setNewEntryParticipantId,
  setNewPartnerParticipantId,
  setPaymentParticipantIds,
  setPartnerChoice,
  setEntrantName,
  setEntrantEmail,
  setEntrantPhone,
  setEntrantGender,
  setEntrantSkillLevel,
  setPartnerName,
  setPartnerEmail,
  setPartnerPhone,
  setPartnerGender,
  setPartnerSkillLevel,
  setRegistrationRefresh,
}: {
  db: SupabaseClient;
  eventId: string;
  currentUserEmail: string | null;
  currentUserId: string | null;
  isEventGuest: boolean;
  leagueTournament: boolean;
  leagueRegistrationCategory: string;
  registrationCategory: string;
  effectiveRegistrationMode: 'individual' | 'pair';
  entrantName: string;
  entrantEmail: string;
  entrantPhone: string;
  entrantGender: string;
  entrantSkillLevel: string;
  partnerChoice: string;
  partnerName: string;
  partnerEmail: string;
  partnerPhone: string;
  partnerGender: string;
  partnerSkillLevel: string;
  profileGender: string | null;
  partnerMembers: PartnerMember[];
  participants: Participant[];
  priceCents: number;
  requestPartnerInvitation: (participantId: string) => Promise<void>;
  setRegistrationBusy: Dispatch<SetStateAction<boolean>>;
  setRegistrationError: Dispatch<SetStateAction<string>>;
  setRegistrationMessage: Dispatch<SetStateAction<string>>;
  setNewEntryParticipantId: Dispatch<SetStateAction<string | null>>;
  setNewPartnerParticipantId: Dispatch<SetStateAction<string | null>>;
  setPaymentParticipantIds: Dispatch<SetStateAction<string[]>>;
  setPartnerChoice: Dispatch<SetStateAction<string>>;
  setEntrantName: Dispatch<SetStateAction<string>>;
  setEntrantEmail: Dispatch<SetStateAction<string>>;
  setEntrantPhone: Dispatch<SetStateAction<string>>;
  setEntrantGender: Dispatch<SetStateAction<string>>;
  setEntrantSkillLevel: Dispatch<SetStateAction<string>>;
  setPartnerName: Dispatch<SetStateAction<string>>;
  setPartnerEmail: Dispatch<SetStateAction<string>>;
  setPartnerPhone: Dispatch<SetStateAction<string>>;
  setPartnerGender: Dispatch<SetStateAction<string>>;
  setPartnerSkillLevel: Dispatch<SetStateAction<string>>;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
}) {
  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistrationBusy(true);
    setRegistrationError('');
    setRegistrationMessage('');
    try {
      const entryCategory = leagueTournament ? leagueRegistrationCategory : registrationCategory;
      if (isEventGuest && (!entrantName.trim() || !currentUserEmail))
        throw new Error('Enter your name to continue. Your verified email is required.');
      const useNewPartner =
        effectiveRegistrationMode === 'pair' &&
        (isEventGuest || !currentUserId || partnerChoice === 'new');
      if (currentUserId && !isEventGuest && effectiveRegistrationMode === 'pair' && !partnerChoice)
        throw new Error('Choose a registered partner or enter new partner details.');
      if (useNewPartner && (!partnerName.trim() || !partnerEmail.trim()))
        throw new Error('Enter your partner’s name and email.');
      const entrantGenderValue = isEventGuest
        ? entrantGender || null
        : currentUserId
          ? profileGender
          : entrantGender || null;
      const selectedPartner = currentUserId
        ? partnerMembers.find((member) => member.id === partnerChoice)
        : participants.find((participant) => participant.id === partnerChoice);
      const partnerGenderValue = useNewPartner
        ? partnerGender || null
        : selectedPartner?.gender ||
          ('gender_override' in (selectedPartner || {})
            ? (selectedPartner as Participant).gender_override
            : null) ||
          null;
      if (!isGenderEligibleForCategory(entryCategory, entrantGenderValue))
        throw new Error(`The entered gender is not eligible for ${categoryLabel(entryCategory)}.`);
      if (
        effectiveRegistrationMode === 'pair' &&
        partnerChoice &&
        partnerChoice !== 'new' &&
        !isGenderEligibleForCategory(entryCategory, partnerGenderValue)
      )
        throw new Error(
          `The selected partner's gender is not eligible for ${categoryLabel(entryCategory)}.`,
        );
      if (
        effectiveRegistrationMode === 'pair' &&
        useNewPartner &&
        !isGenderEligibleForCategory(entryCategory, partnerGenderValue)
      )
        throw new Error(
          `The partner's gender is not eligible for ${categoryLabel(entryCategory)}.`,
        );
      if (
        entryCategory === 'mixed' &&
        effectiveRegistrationMode === 'pair' &&
        ['male', 'female'].includes(entrantGenderValue || '') &&
        ['male', 'female'].includes(partnerGenderValue || '') &&
        entrantGenderValue === partnerGenderValue
      )
        throw new Error(
          'Mixed doubles requires one male and one female player when both genders are known.',
        );

      const partnerRegistrationArgs = {
        p_partner_name: useNewPartner ? partnerName.trim() : null,
        p_partner_email: useNewPartner ? partnerEmail.trim() : null,
        p_partner_phone: useNewPartner ? partnerPhone.trim() || null : null,
        p_partner_gender: useNewPartner ? partnerGender || null : null,
      };
      const partnerSkillLevelValue =
        useNewPartner && partnerSkillLevel ? Number(partnerSkillLevel) : null;
      const sharedRegistrationArgs = {
        p_event_id: eventId,
        p_category: entryCategory,
        p_phone: entrantPhone.trim() || null,
        p_gender: entrantGender || null,
        ...partnerRegistrationArgs,
      };
      const registrationArgs = {
        ...sharedRegistrationArgs,
        p_display_name: entrantName.trim() || null,
        p_email: entrantEmail.trim() || null,
        p_partner_participant_id: null,
        p_partner_user_id:
          effectiveRegistrationMode === 'pair' &&
          currentUserId &&
          partnerChoice &&
          partnerChoice !== 'new'
            ? partnerChoice
            : null,
        p_tennis_skill_level: isEventGuest && entrantSkillLevel ? Number(entrantSkillLevel) : null,
        p_partner_tennis_skill_level: partnerSkillLevelValue,
      };
      const registrationResult = isEventGuest
        ? await db.rpc('register_event_guest_tournament_entry', {
            ...sharedRegistrationArgs,
            p_display_name: entrantName.trim(),
            p_tennis_skill_level: entrantSkillLevel ? Number(entrantSkillLevel) : null,
            p_partner_skill_level: partnerSkillLevelValue,
          })
        : leagueTournament && effectiveRegistrationMode === 'individual'
          ? await db.rpc('register_league_single_event_entry', { p_event_id: eventId })
          : await db.rpc('register_tournament_entry', registrationArgs);
      const { data, error } = registrationResult;
      if (error) throw new Error(error.message);
      const result = data as {
        participantId?: string;
        amountCents?: number;
        partnerParticipantId?: string | null;
        paymentStatus?: string;
        partnerEmail?: string | null;
      };
      const amountDue = (result.amountCents ?? priceCents) > 0;
      let statusMessage =
        amountDue && result.paymentStatus === 'paid'
          ? 'Your previous non-refunded payment was applied to this category.'
          : amountDue
            ? result.partnerParticipantId
              ? 'Registration saved. Your team can pay after your partner confirms.'
              : 'Registration saved. Payment is pending; you can pay when ready.'
            : 'Registration confirmed.';
      if (result.partnerParticipantId) {
        try {
          await requestPartnerInvitation(result.partnerParticipantId);
          statusMessage += result.partnerEmail
            ? ' If that member exists, they will receive a notification to confirm their tournament participation. A non-member partner will receive a sign-in link.'
            : ' Your partner will receive a confirmation request.';
        } catch (error) {
          statusMessage += ` The entry is saved, but the partner confirmation email could not be sent: ${error instanceof Error ? error.message : 'please retry'}.`;
        }
      }
      setRegistrationMessage(statusMessage);
      const selectedPartnerAlreadyPaid =
        !!result.partnerParticipantId &&
        participants.some(
          (participant) =>
            participant.id === result.partnerParticipantId && participant.payment_status === 'paid',
        );
      setNewEntryParticipantId(result.participantId ?? null);
      setNewPartnerParticipantId(result.partnerParticipantId ?? null);
      setPaymentParticipantIds(
        amountDue && result.participantId && result.paymentStatus !== 'paid'
          ? [
              result.participantId,
              ...(result.partnerParticipantId && !selectedPartnerAlreadyPaid
                ? [result.partnerParticipantId]
                : []),
            ]
          : [],
      );
      setPartnerChoice('');
      if (!isEventGuest) {
        setEntrantName('');
        setEntrantEmail('');
        setEntrantPhone('');
        setEntrantGender('');
        setEntrantSkillLevel('');
      }
      setPartnerName('');
      setPartnerEmail('');
      setPartnerPhone('');
      setPartnerGender('');
      setPartnerSkillLevel('');
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not register for this tournament.',
      );
    } finally {
      setRegistrationBusy(false);
    }
  }

  return { submitRegistration };
}
