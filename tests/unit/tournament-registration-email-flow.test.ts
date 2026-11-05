import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTournamentRegistrationSubmit } from '@/components/use-tournament-registration-submit';

const participantId = '11111111-1111-4111-8111-111111111111';

function useRegistrationOptions({ leagueTournament = false }: { leagueTournament?: boolean } = {}) {
  const db = {
    rpc: vi.fn().mockResolvedValue({
      data: { participantId, amountCents: 0, paymentStatus: 'not_required' },
      error: null,
    }),
  } as unknown as SupabaseClient;
  const setRegistrationMessage = vi.fn();
  const { submitRegistration } = useTournamentRegistrationSubmit({
    db,
    eventId: 'event-1',
    currentUserEmail: 'player@example.test',
    currentUserId: 'member-1',
    isEventGuest: false,
    leagueTournament,
    leagueRegistrationCategory: 'men',
    registrationCategory: 'men',
    effectiveRegistrationMode: 'individual',
    entrantName: '',
    entrantEmail: '',
    entrantPhone: '',
    entrantGender: '',
    entrantSkillLevel: '',
    partnerChoice: '',
    partnerName: '',
    partnerEmail: '',
    partnerPhone: '',
    partnerGender: '',
    partnerSkillLevel: '',
    profileGender: 'male',
    partnerMembers: [],
    participants: [],
    priceCents: 0,
    requestPartnerInvitation: vi.fn(),
    setRegistrationBusy: vi.fn(),
    setRegistrationError: vi.fn(),
    setRegistrationMessage,
    setNewEntryParticipantId: vi.fn(),
    setNewPartnerParticipantId: vi.fn(),
    setPaymentParticipantIds: vi.fn(),
    setPartnerChoice: vi.fn(),
    setEntrantName: vi.fn(),
    setEntrantEmail: vi.fn(),
    setEntrantPhone: vi.fn(),
    setEntrantGender: vi.fn(),
    setEntrantSkillLevel: vi.fn(),
    setPartnerName: vi.fn(),
    setPartnerEmail: vi.fn(),
    setPartnerPhone: vi.fn(),
    setPartnerGender: vi.fn(),
    setPartnerSkillLevel: vi.fn(),
    setRegistrationRefresh: vi.fn(),
  });
  return { db, setRegistrationMessage, submitRegistration };
}

afterEach(() => vi.unstubAllGlobals());

describe('single tournament registration email flow', () => {
  it.each([false, true])(
    'requests a confirmation email after a successful single registration (League: %s)',
    async (leagueTournament) => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const { db, submitRegistration } = useRegistrationOptions({ leagueTournament });

      await submitRegistration({
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLFormElement>);

      expect(db.rpc).toHaveBeenCalledWith(
        leagueTournament ? 'register_league_single_event_entry' : 'register_tournament_entry',
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/events/tournament-registration-confirmation',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ participantId }),
        }),
      );
    },
  );
});
