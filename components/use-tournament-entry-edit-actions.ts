import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function useTournamentEntryEditActions({
  db,
  partnerEditName,
  partnerEditEmail,
  partnerEditPhone,
  partnerEditGender,
  partnerEditSkill,
  ownEditName,
  ownEditPhone,
  ownEditGender,
  ownEditSkill,
  requestPartnerInvitation,
  setPartnerEditBusy,
  setPartnerEditTarget,
  setOwnEditBusy,
  setOwnEditTarget,
  setRegistrationError,
  setRegistrationMessage,
  setRegistrationRefresh,
}: {
  db: SupabaseClient;
  partnerEditName: string;
  partnerEditEmail: string;
  partnerEditPhone: string;
  partnerEditGender: string;
  partnerEditSkill: string;
  ownEditName: string;
  ownEditPhone: string;
  ownEditGender: string;
  ownEditSkill: string;
  requestPartnerInvitation: (participantId: string) => Promise<void>;
  setPartnerEditBusy: Dispatch<SetStateAction<boolean>>;
  setPartnerEditTarget: Dispatch<SetStateAction<string | null>>;
  setOwnEditBusy: Dispatch<SetStateAction<boolean>>;
  setOwnEditTarget: Dispatch<SetStateAction<string | null>>;
  setRegistrationError: Dispatch<SetStateAction<string>>;
  setRegistrationMessage: Dispatch<SetStateAction<string>>;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
}) {
  async function savePartnerChange(participantId: string) {
    setPartnerEditBusy(true);
    setRegistrationError('');
    try {
      if (!partnerEditGender) throw new Error('Select your partner’s gender.');
      const { data, error } = await db.rpc('update_unconfirmed_tournament_partner', {
        p_participant_id: participantId,
        p_partner_user_id: null,
        p_partner_name: partnerEditName.trim(),
        p_partner_email: partnerEditEmail.trim(),
        p_partner_phone: partnerEditPhone.trim() || null,
        p_partner_gender: partnerEditGender || null,
        p_partner_skill_level: partnerEditSkill ? Number(partnerEditSkill) : null,
      });
      if (error) throw new Error(error.message);
      const invite = data as { partnerParticipantId?: string };
      if (invite.partnerParticipantId) await requestPartnerInvitation(invite.partnerParticipantId);
      setPartnerEditTarget(null);
      setRegistrationMessage(
        'Partner updated. The new partner must confirm before the team can pay.',
      );
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not update your partner.',
      );
    } finally {
      setPartnerEditBusy(false);
    }
  }

  async function switchToSingle(participantId: string) {
    setPartnerEditBusy(true);
    setRegistrationError('');
    try {
      const { error } = await db.rpc('remove_unconfirmed_tournament_partner', {
        p_participant_id: participantId,
      });
      if (error) throw new Error(error.message);
      setRegistrationMessage(
        'Your pending partner was removed. Your individual entry remains saved.',
      );
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not change to a single entry.',
      );
    } finally {
      setPartnerEditBusy(false);
    }
  }

  async function saveOwnEventDetails(participantId: string) {
    setOwnEditBusy(true);
    setRegistrationError('');
    try {
      if (!ownEditGender) throw new Error('Select your gender.');
      const { error } = await db.rpc('update_event_guest_registration_details', {
        p_participant_id: participantId,
        p_display_name: ownEditName.trim(),
        p_phone: ownEditPhone.trim() || null,
        p_gender: ownEditGender || null,
        p_tennis_skill_level: ownEditSkill ? Number(ownEditSkill) : null,
      });
      if (error) throw new Error(error.message);
      setOwnEditTarget(null);
      setRegistrationMessage('Your event registration details were updated.');
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not update your details.',
      );
    } finally {
      setOwnEditBusy(false);
    }
  }

  return { savePartnerChange, switchToSingle, saveOwnEventDetails };
}
