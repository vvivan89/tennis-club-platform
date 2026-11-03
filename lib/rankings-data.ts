import { createServiceRoleClient } from '@/lib/supabase-service';
import type { RankingPlayer, SeasonSettings } from '@/lib/player-rankings';
import { calculatePlayerStats } from '@/lib/player-rankings';

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  tennis_skill_level: string | null;
  gender: 'male' | 'female' | null;
  application_status: string;
  role: string | null;
};
type ScoreRow = {
  id: string;
  event_id: string;
  played_at: string | null;
  player_one_registration_id: string;
  player_two_registration_id: string;
  player_three_registration_id: string | null;
  player_four_registration_id: string | null;
  player_one_score: number;
  player_two_score: number;
};
type RegistrationRow = { id: string; user_id: string; event_id: string };
type TournamentSetRow = {
  id: string;
  event_id: string;
  played_at: string | null;
  player_one_user_id: string | null;
  player_two_user_id: string | null;
  player_three_user_id: string | null;
  player_four_user_id: string | null;
  player_one_score: number;
  player_two_score: number;
};
type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  social_doubles_ladder_id?: string | null;
};
type MembershipRow = { id: string; user_id: string; status: string; payment_status: string | null };
type PaymentRow = { business_record_id: string | null; user_id: string | null; status: string };
type FamilyRow = {
  id: string;
  paid_at: string | null;
  payment_id: string | null;
  season_year: number;
};
type FamilyMemberRow = { user_id: string; family_id: string; status: string };
export type PlayerGame = {
  id: string;
  eventId: string;
  eventTitle: string;
  playedAt: string;
  playerIds: string[];
  sideOneIds: string[];
  sideTwoIds: string[];
  scoreOne: number;
  scoreTwo: number;
};
export type RankingsData = {
  players: RankingPlayer[];
  eligibleUserIds: Set<string>;
  games: PlayerGame[];
  profileById: Map<string, string>;
  events: EventRow[];
  settings: SeasonSettings;
};

export async function getRankingsData(): Promise<RankingsData> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server-side Supabase configuration is missing.');
  const admin = createServiceRoleClient(url, key);
  const [
    { data: profiles },
    { data: memberships },
    { data: payments },
    { data: families },
    { data: familyMembers },
    { data: settingsRow },
    { data: scores },
    { data: events },
    { data: tournamentSets },
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('id,full_name,email,tennis_skill_level,gender,application_status,role')
      .eq('application_status', 'approved')
      .eq('account_kind', 'member'),
    admin.from('memberships').select('id,user_id,status,payment_status'),
    admin
      .from('payments')
      .select('business_record_id,user_id,status')
      .eq('purpose', 'membership')
      .eq('status', 'succeeded'),
    admin.from('membership_families').select('id,paid_at,payment_id,season_year'),
    admin
      .from('membership_family_members')
      .select('user_id,family_id,status')
      .in('status', ['confirmed', 'removed_next_season']),
    admin
      .from('membership_plan_settings')
      .select('season_start_month,season_start_day,season_end_month,season_end_day')
      .eq('id', 1)
      .maybeSingle(),
    admin
      .from('event_scores')
      .select(
        'id,event_id,played_at,player_one_registration_id,player_two_registration_id,player_three_registration_id,player_four_registration_id,player_one_score,player_two_score',
      )
      .order('played_at', { ascending: false }),
    admin.from('events').select('id,title,starts_at,ends_at,social_doubles_ladder_id'),
    admin
      .from('tournament_ranked_sets')
      .select(
        'id,event_id,played_at,player_one_user_id,player_two_user_id,player_three_user_id,player_four_user_id,player_one_score,player_two_score',
      ),
  ]);
  const approved = (profiles ?? []) as ProfileRow[];
  const membershipRows = (memberships ?? []) as MembershipRow[];
  const paymentRows = (payments ?? []) as PaymentRow[];
  const familyRows = (families ?? []) as FamilyRow[];
  const familyMemberRows = (familyMembers ?? []) as FamilyMemberRow[];
  const paidMembershipIds = new Set(paymentRows.map((x) => x.business_record_id).filter(Boolean));
  const paidUserIds = new Set<string>();
  for (const m of membershipRows) {
    if (
      ['active', 'expired'].includes(m.status) &&
      (m.payment_status === 'paid' || paidMembershipIds.has(m.id))
    )
      paidUserIds.add(m.user_id);
  }
  const seasonSettings = (settingsRow ?? {
    season_start_month: 4,
    season_start_day: 1,
    season_end_month: 9,
    season_end_day: 30,
  }) as SeasonSettings;
  const paidFamilyIds = new Set(
    familyRows.filter((f) => Boolean(f.paid_at || f.payment_id)).map((f) => f.id),
  );
  for (const fm of familyMemberRows) {
    if (paidFamilyIds.has(fm.family_id)) paidUserIds.add(fm.user_id);
  }
  const scoreRows = (scores ?? []) as ScoreRow[];
  const registrationIds = [
    ...new Set(
      scoreRows.flatMap(
        (s) =>
          [
            s.player_one_registration_id,
            s.player_two_registration_id,
            s.player_three_registration_id,
            s.player_four_registration_id,
          ].filter(Boolean) as string[],
      ),
    ),
  ];
  const { data: registrations } = registrationIds.length
    ? await admin.from('registrations').select('id,user_id,event_id').in('id', registrationIds)
    : { data: [] as RegistrationRow[] };
  const regById = new Map(((registrations ?? []) as RegistrationRow[]).map((r) => [r.id, r]));
  const eventById = new Map(((events ?? []) as EventRow[]).map((e) => [e.id, e]));
  const games: PlayerGame[] = scoreRows.flatMap((s) => {
    const ev = eventById.get(s.event_id);
    const playedAt = s.played_at || ev?.starts_at;
    if (!playedAt || new Date(playedAt).getTime() > Date.now()) return [];
    const doubles = Boolean(s.player_three_registration_id);
    const sideOneReg = doubles
      ? [s.player_one_registration_id, s.player_two_registration_id]
      : [s.player_one_registration_id];
    const sideTwoReg = doubles
      ? [s.player_three_registration_id, s.player_four_registration_id]
      : [s.player_two_registration_id];
    const sideOneIds = sideOneReg
      .filter((id): id is string => typeof id === 'string')
      .map((id) => regById.get(id)?.user_id)
      .filter((id): id is string => typeof id === 'string');
    const sideTwoIds = sideTwoReg
      .filter((id): id is string => typeof id === 'string')
      .map((id) => regById.get(id)?.user_id)
      .filter((id): id is string => typeof id === 'string');
    if (!sideOneIds.length || !sideTwoIds.length) return [];
    return [
      {
        id: s.id,
        eventId: s.event_id,
        eventTitle: ev?.title || 'Game',
        playedAt,
        playerIds: [...sideOneIds, ...sideTwoIds],
        sideOneIds,
        sideTwoIds,
        scoreOne: Number(s.player_one_score) || 0,
        scoreTwo: Number(s.player_two_score) || 0,
      },
    ];
  });
  const tournamentGames: PlayerGame[] = ((tournamentSets ?? []) as TournamentSetRow[]).flatMap(
    (row) => {
      const ev = eventById.get(row.event_id);
      const playedAt = row.played_at || ev?.starts_at;
      if (!playedAt || new Date(playedAt).getTime() > Date.now()) return [];
      const sideOneIds = [row.player_one_user_id, row.player_two_user_id].filter(
        (id): id is string => !!id,
      );
      const sideTwoIds = [row.player_three_user_id, row.player_four_user_id].filter(
        (id): id is string => !!id,
      );
      if (!sideOneIds.length || !sideTwoIds.length) return [];
      return [
        {
          id: row.id,
          eventId: row.event_id,
          eventTitle: ev?.title || 'Tournament',
          playedAt,
          playerIds: [...sideOneIds, ...sideTwoIds],
          sideOneIds,
          sideTwoIds,
          scoreOne: Number(row.player_one_score) || 0,
          scoreTwo: Number(row.player_two_score) || 0,
        },
      ];
    },
  );
  games.push(...tournamentGames);
  const players: RankingPlayer[] = calculatePlayerStats(
    approved.map((p) => ({
      id: p.id,
      name: p.full_name?.trim() || p.email || 'Player',
      gender: p.gender ?? null,
      skillRating: p.tennis_skill_level ? Number(p.tennis_skill_level) : null,
    })),
    games,
  );
  const profileById = new Map(
    approved.map((p) => [p.id, p.full_name?.trim() || p.email || 'Player']),
  );
  return {
    players,
    eligibleUserIds: paidUserIds,
    games,
    profileById,
    events: (events ?? []) as EventRow[],
    settings: seasonSettings,
  };
}
