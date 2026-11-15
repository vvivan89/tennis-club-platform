import { describe, expect, it } from 'vitest';
import { getTournamentPublicRegistrationState } from '@/components/tournament-public-registration-state';

function state(leagueGender: string | null, categories: string[]) {
  return getTournamentPublicRegistrationState({
    detailsPublic: true,
    currentUserIsApprovedMember: false,
    currentUserId: null,
    ownParticipantCount: 0,
    format: 'doubles',
    leagueTournament: true,
    teams: [],
    isManager: false,
    leagueGender,
    isEventGuest: false,
    entrantGender: '',
    profileGender: null,
    config: { categories, registration_mode: 'both' },
    ownCategories: [],
    eventStatus: 'published',
    registrationOpensAt: '2026-01-01T00:00:00.000Z',
    registrationClosesAt: null,
    startsAt: '2027-01-01T00:00:00.000Z',
    registrationMode: 'pair',
  });
}

describe('League public registration category', () => {
  it('uses Mixed doubles for a Mixed League', () => {
    expect(state('mixed', ['mixed']).leagueRegistrationCategory).toBe('mixed');
  });

  it('falls back to the event category when League identity is not readable', () => {
    expect(state(null, ['men']).leagueRegistrationCategory).toBe('men');
    expect(state(null, ['women']).leagueRegistrationCategory).toBe('women');
  });
});
