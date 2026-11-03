import type { MembershipSeasonSettings } from '@/lib/membership-season';

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  application_status?: string;
  tennis_skill_level?: number | null;
};
export type FamilyMember = {
  id: string;
  user_id: string;
  status: string;
  invited_by?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
  waiver_version?: string | null;
  waiver_accepted_at?: string | null;
  profiles?: { id?: string; full_name: string | null; email: string | null } | null;
};
export type Family = {
  id: string;
  season_year: number;
  paid_at: string | null;
  paid_by?: string | null;
  payment_id: string | null;
};
export type FamilyEntry = {
  membership: {
    id: string;
    family_id: string;
    user_id: string;
    invited_by?: string | null;
    status: string;
    joined_at: string | null;
    created_at: string;
    waiver_version?: string | null;
    waiver_accepted_at?: string | null;
  };
  family: Family;
  members: FamilyMember[];
};
export type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  tennis_skill_level: number | null;
  date_of_birth?: string | null;
  available?: boolean;
  unavailableReason?: string;
};
export type MembershipSettings = MembershipSeasonSettings & {
  single_price_cents: number;
  family_price_cents: number;
  family_max_adults: number;
  family_max_children: number;
  season_start_month: number;
  season_start_day: number;
  season_end_month: number;
  season_end_day: number;
};
export type Membership = {
  id: string;
  user_id: string;
  membership_type: string;
  status: string;
  payment_status: string;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  waiver_version?: string | null;
  waiver_accepted_at?: string | null;
};
export type Payment = {
  id: string;
  purpose: string;
  business_record_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  created_at: string;
  succeeded_at: string | null;
  refunded_amount_minor: number;
  provider?: string | null;
  manual_review_status?: string | null;
};
export type MembershipPortalState = {
  families: FamilyEntry[];
  people: Person[];
  settings: MembershipSettings | null;
  memberships: Membership[];
  payments: Payment[];
  currentWaiver: { version: number; title: string; body_html: string } | null;
};
