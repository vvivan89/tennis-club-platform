import { getTournamentRegistrationOptions } from '@/components/tournament-registration-options';
import type { Team } from '@/components/tournament-public-view-types';
import type { TournamentConfig } from '@/lib/tournament-config';

export function getTournamentPublicRegistrationState({
  detailsPublic,
  currentUserIsApprovedMember,
  currentUserId,
  ownParticipantCount,
  format,
  leagueTournament,
  teams,
  isManager,
  leagueGender,
  isEventGuest,
  entrantGender,
  profileGender,
  config,
  ownCategories,
  eventStatus,
  registrationOpensAt,
  registrationClosesAt,
  startsAt,
  registrationMode,
}: {
  detailsPublic: boolean;
  currentUserIsApprovedMember: boolean;
  currentUserId: string | null;
  ownParticipantCount: number;
  format: string | null;
  leagueTournament: boolean;
  teams: Team[];
  isManager: boolean;
  leagueGender: string | null;
  isEventGuest: boolean;
  entrantGender: string;
  profileGender: string | null;
  config: TournamentConfig | null;
  ownCategories: string[];
  eventStatus: string;
  registrationOpensAt: string;
  registrationClosesAt: string | null;
  startsAt: string;
  registrationMode: 'individual' | 'pair';
}) {
  const canViewCompetition =
    detailsPublic || currentUserIsApprovedMember || (!!currentUserId && ownParticipantCount > 0);
  const isTeamCaptain =
    format === 'team' &&
    !leagueTournament &&
    !!currentUserId &&
    teams.some((team) => team.captain_user_id === currentUserId);
  const leagueRegistrationCategory = leagueGender === 'male' ? 'men' : 'women';
  const registrationGender = isEventGuest
    ? entrantGender || null
    : currentUserId
      ? profileGender
      : entrantGender || null;
  const registrationOptions = getTournamentRegistrationOptions({
    config,
    format,
    leagueTournament,
    leagueRegistrationCategory,
    ownCategories,
    registrationGender,
    currentUserId,
  });
  const registrationOpen =
    eventStatus === 'published' &&
    Date.now() >= new Date(registrationOpensAt).getTime() &&
    Date.now() < new Date(registrationClosesAt || startsAt).getTime();
  const registrationModeConfig = config?.registration_mode ?? 'both';
  const effectiveRegistrationMode =
    registrationModeConfig === 'single'
      ? 'individual'
      : registrationModeConfig === 'doubles'
        ? 'pair'
        : registrationMode;

  return {
    canViewCompetition,
    isTeamCaptain,
    captainOnlyView: isTeamCaptain && !isManager,
    leagueRegistrationCategory,
    registrationGender,
    hasGenderEligibleCategory: registrationOptions.hasGenderEligibleCategory,
    availableCategories: registrationOptions.availableCategories,
    registrationOpen,
    registrationModeConfig,
    effectiveRegistrationMode,
  };
}
