import type { TournamentMatchCore } from '@/lib/tournament-match';

export type Team = {
  id: string;
  name: string;
  logo_url: string | null;
  color: string;
  group_number: number | null;
  captain_user_id: string | null;
};

export type Participant = {
  id: string;
  user_id: string | null;
  team_id: string | null;
  category: string;
  payment_status: string;
  amount_cents: number;
  display_name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  gender_override: string | null;
  status: string;
  confirmation_status?: string;
  captain_requested?: boolean;
};

export type Pair = {
  id: string;
  category: string;
  player_one_id: string;
  player_two_id: string;
  group_number: number | null;
  status?: string;
  league_team_id?: string | null;
  player_one_name?: string;
  player_two_name?: string;
};

export type MatchPlayer = {
  match_id: string;
  participant_id: string;
  side: number;
  team_id: string | null;
};

export type Match = TournamentMatchCore & {
  notes: string;
  player_one_name?: string | null;
  opponent_one_name?: string | null;
};
export type Member = { id: string; full_name: string; email: string; gender: string | null };
