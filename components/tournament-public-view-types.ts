import type { TournamentMatchCore } from '@/lib/tournament-match';

export type GroupOverride = {
  id: string;
  event_id: string;
  category: string;
  group_number: number;
  entry_id: string;
  override_type: 'ranking' | 'promotion';
  override_value: number;
  reason: string;
};

export type Team = {
  id: string;
  name: string;
  logo_url: string | null;
  color: string;
  group_number: number | null;
  captain_user_id: string | null;
  captain_name: string | null;
};

export type Participant = {
  id: string;
  event_id: string;
  team_id: string | null;
  category: string;
  display_name: string;
  gender: string | null;
  gender_override?: string | null;
  status: string;
  payment_status?: string;
  tennis_skill_level?: number | null;
  is_member?: boolean;
};

export type PartnerMember = { id: string; full_name: string; gender: string | null };

export type PairPaymentStatus = {
  pair_id: string;
  player_one_id: string;
  player_two_id: string;
  player_one_payment_status: string;
  player_two_payment_status: string;
};

export type OwnTournamentEntry = {
  id: string;
  team_id: string | null;
  category: string;
  payment_status: string;
  amount_cents: number;
  display_name?: string;
  email?: string;
  phone?: string | null;
  gender?: string | null;
  tennis_skill_level?: number | null;
  confirmation_status?: string;
  partner_id?: string | null;
  partner_name?: string | null;
  partner_email?: string | null;
  partner_phone?: string | null;
  partner_gender?: string | null;
  partner_skill_level?: number | null;
  partner_confirmation_status?: string | null;
  partner_is_league_team?: boolean;
};

export type TournamentPartnerConfirmation = {
  participantId: string;
  participantName: string;
  email: string;
  phone: string | null;
  gender: string | null;
  tennisSkillLevel: number | null;
  eventTitle: string;
  invitedBy: string;
};

export type Pair = {
  id: string;
  event_id: string;
  category: string;
  player_one_id: string;
  player_two_id: string;
  group_number: number | null;
  seed: number | null;
  status: string;
  player_one_name: string;
  player_two_name: string;
  player_one_skill_level?: number | null;
  player_two_skill_level?: number | null;
};

export type MatchPlayer = {
  match_id: string;
  participant_id: string;
  side: number;
  team_id: string | null;
};

export type Match = TournamentMatchCore & {
  event_id: string;
  team_one_name: string | null;
  team_two_name: string | null;
  player_one_name: string | null;
  player_two_name: string | null;
  opponent_one_name: string | null;
  opponent_two_name: string | null;
  notes?: string | null;
};

import type { ReactNode } from 'react';
import type { TournamentConfig } from '@/lib/tournament-config';

export type TournamentPublicViewProps = {
  adminContent?: ReactNode;
  eventTitle?: string;
  eventDescription?: string | null;
  genderRestriction?: string | null;
  eventSlug?: string;
  eventId: string;
  currentUserId: string | null;
  currentUserEmail?: string | null;
  currentUserAccountKind?: string;
  currentUserName?: string;
  currentUserPhone?: string;
  currentUserSkillLevel?: string | null;
  currentUserGender?: string | null;
  format: string | null;
  config: TournamentConfig | null;
  rulesHtml: string | null;
  detailsPublic: boolean;
  allowNonMemberRegistration: boolean;
  eventStatus: string;
  startsAt: string;
  endsAt: string | null;
  locationQuery: string;
  registrationOpensAt: string;
  registrationClosesAt: string | null;
  priceCents: number;
  interacEnabled?: boolean;
  resultsOnly?: boolean;
  rankingsControl?: ReactNode;
  leagueTournament?: boolean;
  leagueId?: string | null;
  leagueGender?: string | null;
  leagueStandingsBefore?: Array<Record<string, unknown>>;
  leagueStandingsAfter?: Array<Record<string, unknown>>;
  leagueHasResults?: boolean;
  courtCount?: number;
};
