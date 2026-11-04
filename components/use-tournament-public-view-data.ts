import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeagueCourtAssignment } from '@/components/league-court-assignment-dialog';
import type {
  GroupOverride,
  Match,
  MatchPlayer,
  OwnTournamentEntry,
  Pair,
  PairPaymentStatus,
  Participant,
  PartnerMember,
  Team,
} from '@/components/tournament-public-view-types';
import type { InteracPaymentNotice } from '@/components/interac-payment-instructions-dialog';
import {
  formatMoney,
  tournamentPaymentActionKey,
} from '@/components/tournament-public-view-format';

export function useTournamentPublicViewData({
  db,
  eventId,
  currentUserId,
  currentUserGender,
  leagueTournament,
  leagueId,
  interacEnabled,
  registrationRefresh,
  setPaymentParticipantIds,
}: {
  db: SupabaseClient;
  eventId: string;
  currentUserId: string | null;
  currentUserGender: string | null;
  leagueTournament: boolean;
  leagueId: string | null;
  interacEnabled: boolean;
  registrationRefresh: number;
  setPaymentParticipantIds: Dispatch<SetStateAction<string[]>>;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [groupOverrides, setGroupOverrides] = useState<GroupOverride[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [partnerMembers, setPartnerMembers] = useState<PartnerMember[]>([]);
  const [pairPaymentStatuses, setPairPaymentStatuses] = useState<PairPaymentStatus[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchPlayers, setMatchPlayers] = useState<MatchPlayer[]>([]);
  const [ownParticipantIds, setOwnParticipantIds] = useState<string[]>([]);
  const [ownEntries, setOwnEntries] = useState<OwnTournamentEntry[]>([]);
  const [profileGender, setProfileGender] = useState<string | null>(currentUserGender);
  const [ownCategories, setOwnCategories] = useState<string[]>([]);
  const [ownTeamIds, setOwnTeamIds] = useState<string[]>([]);
  const [ownLeagueTeamId, setOwnLeagueTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leagueCourtAssignments, setLeagueCourtAssignments] = useState<LeagueCourtAssignment[]>([]);
  const [interacRequests, setInteracRequests] = useState<Record<string, InteracPaymentNotice>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setTeams([]);
    setGroupOverrides([]);
    setParticipants([]);
    setPairs([]);
    setMatches([]);
    setMatchPlayers([]);
    setLeagueCourtAssignments([]);
    setOwnLeagueTeamId(null);

    void (async () => {
      const [
        teamResult,
        participantResult,
        pairResult,
        matchResult,
        ownResult,
        profileResult,
        partnerDirectoryResult,
        pairPaymentResult,
        groupOverrideResult,
        leagueCourtAssignmentResult,
        leagueTeamResult,
        pendingInteracPaymentsResult,
        interacSettingsResult,
      ] = await Promise.all([
        db.from('tournament_public_teams').select('*').eq('event_id', eventId).order('name'),
        db
          .from('tournament_public_participants')
          .select('*')
          .eq('event_id', eventId)
          .order('display_name'),
        db.from('tournament_public_pairs').select('*').eq('event_id', eventId).order('category'),
        db
          .from('tournament_public_matches')
          .select('*')
          .eq('event_id', eventId)
          .order('scheduled_at', { ascending: true, nullsFirst: false })
          .order('court_number', { ascending: true, nullsFirst: true }),
        currentUserId
          ? db.rpc('event_tournament_my_entries', { p_event_id: eventId })
          : Promise.resolve({ data: [], error: null }),
        currentUserId
          ? db.from('profiles').select('gender').eq('id', currentUserId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        currentUserId
          ? db.rpc('event_tournament_partner_directory', { p_event_id: eventId })
          : Promise.resolve({ data: [], error: null }),
        currentUserId
          ? fetch(`/api/tournaments/${eventId}/pair-payment-status`, { cache: 'no-store' })
              .then(async (response) => {
                const result = await response.json().catch(() => ({}));
                return {
                  data: response.ok ? (result.data ?? []) : [],
                  error: response.ok ? null : result.error,
                };
              })
              .catch((error) => ({ data: [], error }))
          : Promise.resolve({ data: [], error: null }),
        db.from('tournament_group_overrides').select('*').eq('event_id', eventId),
        leagueTournament
          ? db
              .from('league_event_court_assignments')
              .select('pair_id,court_number,segment_order')
              .eq('event_id', eventId)
          : Promise.resolve({ data: [], error: null }),
        currentUserId && leagueTournament && leagueId
          ? db
              .from('league_teams')
              .select('id')
              .eq('league_id', leagueId)
              .eq('status', 'active')
              .or(`player_one_id.eq.${currentUserId},player_two_id.eq.${currentUserId}`)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        currentUserId && interacEnabled
          ? db
              .from('payments')
              .select('id,business_record_id,amount_minor,status,provider')
              .eq('user_id', currentUserId)
              .eq('purpose', 'tournament_registration')
              .eq('provider', 'interac')
              .in('status', ['pending', 'processing'])
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        currentUserId && interacEnabled
          ? db
              .from('payment_method_settings')
              .select('interac_recipient_email,interac_instructions')
              .eq('id', 1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      const matchIds = (matchResult.data ?? []).map((match) => match.id);
      const matchPlayerResult = matchIds.length
        ? await db
            .from('tournament_match_players')
            .select('match_id,participant_id,side,team_id')
            .in('match_id', matchIds)
        : { data: [], error: null };
      if (!active) return;

      setTeams((teamResult.data ?? []) as Team[]);
      setGroupOverrides((groupOverrideResult.data ?? []) as GroupOverride[]);
      setParticipants((participantResult.data ?? []) as Participant[]);
      setPartnerMembers((partnerDirectoryResult.data ?? []) as PartnerMember[]);
      setPairPaymentStatuses((pairPaymentResult.data ?? []) as PairPaymentStatus[]);
      setPairs((pairResult.data ?? []) as Pair[]);
      setMatches((matchResult.data ?? []) as Match[]);
      setLeagueCourtAssignments(
        (leagueCourtAssignmentResult.data ?? []) as LeagueCourtAssignment[],
      );
      setMatchPlayers((matchPlayerResult.data ?? []) as MatchPlayer[]);
      setProfileGender((profileResult.data as { gender?: string | null } | null)?.gender ?? null);
      setOwnParticipantIds(
        (ownResult.data ?? []).map((participant: { id: string }) => participant.id),
      );

      const requests: Record<string, InteracPaymentNotice> = {};
      const recipientEmail = interacSettingsResult.data?.interac_recipient_email || '';
      const instructions = interacSettingsResult.data?.interac_instructions || '';
      for (const payment of pendingInteracPaymentsResult.data ?? []) {
        const participantIds = String(payment.business_record_id || '')
          .split(',')
          .filter(Boolean)
          .sort();
        if (!participantIds.length || !payment.id) continue;
        const amount = formatMoney(Number(payment.amount_minor || 0));
        const payerScope = participantIds.length > 1 ? 'both partner entries' : 'your entry';
        requests[tournamentPaymentActionKey(participantIds, 'interac')] = {
          amount,
          recipientEmail,
          paymentId: payment.id,
          instructions,
          message: `Your Interac request for ${payerScope} (${amount}) is pending club confirmation.`,
        };
      }
      setInteracRequests(requests);
      setOwnEntries((ownResult.data ?? []) as OwnTournamentEntry[]);
      const unpaid = (ownResult.data ?? []).find(
        (entry: { payment_status?: string; amount_cents?: number; confirmation_status?: string }) =>
          entry.confirmation_status === 'confirmed' &&
          ['pending', 'failed'].includes(entry.payment_status ?? '') &&
          Number(entry.amount_cents ?? 0) > 0,
      ) as { id: string } | undefined;
      if (unpaid) setPaymentParticipantIds((current) => (current.length ? current : [unpaid.id]));
      setOwnCategories((ownResult.data ?? []).map((entry: { category: string }) => entry.category));
      setOwnTeamIds([
        ...new Set<string>(
          ((ownResult.data ?? []) as Array<{ team_id: string | null }>)
            .map((entry) => entry.team_id)
            .filter((id): id is string => !!id),
        ),
      ]);
      setOwnLeagueTeamId((leagueTeamResult.data as { id?: string } | null)?.id ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [
    db,
    eventId,
    currentUserId,
    currentUserGender,
    leagueTournament,
    leagueId,
    interacEnabled,
    registrationRefresh,
    setPaymentParticipantIds,
  ]);

  return {
    teams,
    setTeams,
    groupOverrides,
    setGroupOverrides,
    participants,
    setParticipants,
    partnerMembers,
    pairPaymentStatuses,
    pairs,
    setPairs,
    matches,
    setMatches,
    matchPlayers,
    setMatchPlayers,
    ownParticipantIds,
    ownEntries,
    setOwnEntries,
    profileGender,
    ownCategories,
    ownTeamIds,
    ownLeagueTeamId,
    loading,
    leagueCourtAssignments,
    setLeagueCourtAssignments,
    interacRequests,
    setInteracRequests,
  };
}
