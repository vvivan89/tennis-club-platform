import type { TournamentConfig } from '@/lib/tournament-config';

export type EventFormValues = {
  id?: string;
  series_id?: string | null;
  organizer_id?: string | null;
  title: string;
  description: string;
  gender_restriction: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string;
  registration_opens_at: string;
  registration_closes_at: string;
  capacity: number;
  price_cents: number;
  allow_plus_one: boolean;
  guest_price_cents: number;
  members_only: boolean;
  status: string;
  location: string;
  notes: string;
  waitlist_enabled: boolean;
  court_count: number;
  tournament_format: string | null;
  tournament_config: TournamentConfig;
  tournament_rules_html: string;
  allow_non_member_registration: boolean;
  tournament_details_public: boolean;
  ladder_gender: 'male' | 'female';
  ladder_points: [number, number, number, number];
  ladder_ranking_priority: string[];
  ladder_carryover: 'none' | 'position' | 'full';
  ladder_previous_id: string;
  ladder_existing_id: string;
  ladder_name: string;
  league_existing_id: string;
  is_league_tournament: boolean;
};

export type OrganizerOption = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
};

export type EventFieldChange = <K extends keyof EventFormValues>(
  key: K,
  value: EventFormValues[K],
) => void;
