'use client';

import Image from 'next/image';
import { buildKnockoutSchedule, phaseStartAfterPrerequisites } from '@/lib/tournament-schedule';
import { pairKnockoutFirstRound } from '@/lib/knockout-draw';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { FormEvent } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { formatDateTime, formatTime } from '@/lib/time-format';
import {
  isGenderEligibleForCategory,
  knockoutStageLabel,
  type TournamentConfig,
} from '@/lib/tournament-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TennisLoader } from '@/components/tennis-loader';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';

type Team = {
  id: string;
  name: string;
  logo_url: string | null;
  color: string;
  group_number: number | null;
  captain_user_id: string | null;
};
type Participant = {
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
};
type Pair = {
  id: string;
  category: string;
  player_one_id: string;
  player_two_id: string;
  group_number: number | null;
  status?: string;
  player_one_name?: string;
  player_two_name?: string;
};
type MatchPlayer = {
  match_id: string;
  participant_id: string;
  side: number;
  team_id: string | null;
};
type Match = {
  id: string;
  category: string;
  phase: string;
  group_number: number | null;
  round_number: number;
  match_number: number;
  pair_one_id: string | null;
  pair_two_id: string | null;
  team_one_id: string | null;
  team_two_id: string | null;
  scheduled_at: string | null;
  court_number: number | null;
  score_sets: Array<{ one: number; two: number }>;
  winner_side: number | null;
  team_points_one: number;
  team_points_two: number;
  status: string;
  notes: string;
};
type Member = { id: string; full_name: string; email: string; gender: string | null };

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

const phases = [
  ['round_robin', 'Round robin'],
  ['preliminary_knockout', 'Preliminary knockout'],
  ['final_knockout', 'Final knockout'],
  ['team_round_robin', 'Team round robin'],
  ['team_knockout', 'Team knockout'],
] as const;
const localDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16) : '';

export function TournamentManagement({
  eventId,
  leagueId = null,
  eventStartsAt,
  eventEndsAt,
  courtCount,
  format,
  config,
  priceCents,
  leagueTournament = false,
  leagueGender = null,
}: {
  eventId: string;
  leagueId?: string | null;
  eventStartsAt: string;
  eventEndsAt: string | null;
  courtCount: number;
  format: string | null;
  config: TournamentConfig | null;
  priceCents: number;
  leagueTournament?: boolean;
  leagueGender?: string | null;
}) {
  const db = createSupabaseBrowserClient();
  const [teams, setTeams] = useState<Team[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchPlayers, setMatchPlayers] = useState<MatchPlayer[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [adminTab, setAdminTab] = useState<'participants' | 'matches' | 'audit'>('participants');
  const [externalTab, setExternalTab] = useState<
    'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit'
  >('participants');
  const [matchGrouping, setMatchGrouping] = useState<'group' | 'round'>('group');
  const [activeCategory, setActiveCategory] = useState<string>(
    (config?.categories ?? ['mixed', 'men', 'women'])[0] ?? 'mixed',
  );
  const [replaceTarget, setReplaceTarget] = useState<{ pair: Pair; side: 1 | 2 } | null>(null);
  const [pendingDeleteMatch, setPendingDeleteMatch] = useState<Match | null>(null);
  const [pendingWalkoverScore, setPendingWalkoverScore] = useState<{
    match: Match;
    raw: string;
  } | null>(null);
  const [pendingRemoveParticipant, setPendingRemoveParticipant] = useState<Participant | null>(
    null,
  );
  const [pendingScheduleConflicts, setPendingScheduleConflicts] = useState<{
    match: Match;
    changes: Partial<Match>;
    conflicts: Match[];
  } | null>(null);
  const [pendingCourtMove, setPendingCourtMove] = useState<{
    match: Match;
    court: number | null;
    conflicts: Array<{ match: Match; severity: 'danger' | 'warning' }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!error && !message) return;
    const timer = window.setTimeout(() => {
      setError('');
      setMessage('');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, message]);
  const [teamName, setTeamName] = useState('');
  const [teamColor, setTeamColor] = useState('');
  const [teamLogo, setTeamLogo] = useState('');
  const [captain, setCaptain] = useState('');
  const [memberId, setMemberId] = useState('');
  const [replacementParticipantId, setReplacementParticipantId] = useState('');
  const [teamPairSelection, setTeamPairSelection] = useState<
    Record<string, { first: string; second: string }>
  >({});
  const [participantName, setParticipantName] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');
  const [participantPhone, setParticipantPhone] = useState('');
  const [participantGender, setParticipantGender] = useState('');
  const [pairCategory, setPairCategory] = useState((config?.categories ?? ['mixed'])[0] ?? 'mixed');
  const [pairOne, setPairOne] = useState('');
  const [pairTwo, setPairTwo] = useState('');
  const [leagueMemberEligibility, setLeagueMemberEligibility] = useState<Record<string, boolean>>(
    {},
  );
  const [matchCategory, setMatchCategory] = useState(
    format === 'team' ? 'team' : ((config?.categories ?? ['mixed'])[0] ?? 'mixed'),
  );
  const [matchPhase, setMatchPhase] = useState(
    format === 'team' ? 'team_round_robin' : 'round_robin',
  );
  const [matchOne, setMatchOne] = useState('');
  const [matchTwo, setMatchTwo] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [matchCourt, setMatchCourt] = useState('');

  const refresh = useCallback(async () => {
    const [
      teamResult,
      participantResult,
      pairResult,
      matchResult,
      memberResult,
      auditResult,
      leagueEligibilityResult,
    ] = await Promise.all([
      db.from('tournament_teams').select('*').eq('event_id', eventId).order('name'),
      db
        .from('tournament_participants')
        .select(
          'id,user_id,team_id,category,payment_status,amount_cents,display_name,email,phone,gender,gender_override,status',
        )
        .eq('event_id', eventId)
        .order('display_name'),
      db.from('tournament_pairs').select('*').eq('event_id', eventId).order('category'),
      db
        .from('tournament_matches')
        .select('*')
        .eq('event_id', eventId)
        .order('scheduled_at', { ascending: true, nullsFirst: false })
        .order('court_number', { ascending: true, nullsFirst: true }),
      db.rpc('event_tournament_member_directory', { p_event_id: eventId }),
      db
        .from('tournament_audit_log')
        .select('id,actor_user_id,action,entity_type,entity_id,before_data,after_data,created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(30),
      leagueTournament
        ? db.rpc('league_event_pair_eligibility', { p_event_id: eventId })
        : Promise.resolve({ data: [], error: null }),
    ]);
    const firstError =
      teamResult.error || participantResult.error || pairResult.error || matchResult.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }
    const nextTeams = (teamResult.data ?? []) as Team[];
    const nextParticipants = (participantResult.data ?? []) as Participant[];
    const nextPairs = ((pairResult.data ?? []) as Pair[]).map((pair) => ({
      ...pair,
      player_one_name: participantResult.data?.find((p: Participant) => p.id === pair.player_one_id)
        ?.display_name,
      player_two_name: participantResult.data?.find((p: Participant) => p.id === pair.player_two_id)
        ?.display_name,
    }));
    const nextMatches = (matchResult.data ?? []) as Match[];
    setTeams((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextTeams) ? previous : nextTeams,
    );
    setParticipants((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextParticipants) ? previous : nextParticipants,
    );
    if (leagueTournament && !leagueEligibilityResult.error) {
      setLeagueMemberEligibility(
        Object.fromEntries(
          (
            (leagueEligibilityResult.data ?? []) as Array<{
              user_id: string;
              eligible: boolean;
            }>
          ).map((entry) => [entry.user_id, entry.eligible]),
        ),
      );
    } else if (!leagueTournament) setLeagueMemberEligibility({});
    setPairs((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextPairs) ? previous : nextPairs,
    );
    setMatches((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextMatches) ? previous : nextMatches,
    );
    const matchIds = (matchResult.data ?? []).map((match: Match) => match.id);
    const { data: playerRows, error: playerRowsError } = matchIds.length
      ? await db
          .from('tournament_match_players')
          .select('match_id,participant_id,side,team_id')
          .in('match_id', matchIds)
      : { data: [], error: null };
    if (!playerRowsError) {
      const nextMatchPlayers = (playerRows ?? []) as MatchPlayer[];
      setMatchPlayers((previous) =>
        JSON.stringify(previous) === JSON.stringify(nextMatchPlayers) ? previous : nextMatchPlayers,
      );
    }
    const nextMembers = (memberResult.data ?? []) as Member[];
    const nextAuditRows = (auditResult.data ?? []) as AuditRow[];
    setMembers((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextMembers) ? previous : nextMembers,
    );
    setAuditRows((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextAuditRows) ? previous : nextAuditRows,
    );
    window.dispatchEvent(new CustomEvent('pctc-tournament-data-refresh', { detail: { eventId } }));
  }, [db, eventId, leagueTournament]);

  useEffect(() => {
    const closeOutsideMenus = (event: PointerEvent) => {
      document
        .querySelectorAll<HTMLDetailsElement>('details[data-tournament-menu="true"][open]')
        .forEach((menu) => {
          if (!menu.contains(event.target as Node)) menu.open = false;
        });
    };
    document.addEventListener('pointerdown', closeOutsideMenus);
    return () => document.removeEventListener('pointerdown', closeOutsideMenus);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const channel = db
      .channel(`tournament-admin-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_teams',
          filter: `event_id=eq.${eventId}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_participants',
          filter: `event_id=eq.${eventId}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_pairs',
          filter: `event_id=eq.${eventId}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_matches',
          filter: `event_id=eq.${eventId}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_match_players' },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_audit_log',
          filter: `event_id=eq.${eventId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    const syncCategory = (event: Event) => {
      const category = (event as CustomEvent<{ category?: string }>).detail?.category;
      if (category) {
        setActiveCategory(category);
        setPairCategory(category);
        setMatchCategory(category);
        setPairOne('');
        setPairTwo('');
        setMatchOne('');
        setMatchTwo('');
      }
    };
    const syncTab = (event: Event) => {
      const tab = (
        event as CustomEvent<{
          tab?: 'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit';
        }>
      ).detail?.tab;
      if (tab) setExternalTab(tab);
      if (tab === 'participants' || tab === 'matches' || tab === 'audit') setAdminTab(tab);
    };
    window.addEventListener('pctc-tournament-category-change', syncCategory);
    window.addEventListener('pctc-tournament-tab-change', syncTab);
    return () => {
      window.removeEventListener('pctc-tournament-category-change', syncCategory);
      window.removeEventListener('pctc-tournament-tab-change', syncTab);
      void db.removeChannel(channel);
    };
  }, [db, eventId, refresh]);
  const activeParticipants = useMemo(
    () => participants.filter((p) => p.status === 'registered'),
    [participants],
  );
  const normalizedProfileGender = (gender: string | null | undefined) => {
    const value = gender?.trim().toLowerCase();
    if (['m', 'man', 'men', 'male'].includes(value || '')) return 'male';
    if (['f', 'woman', 'women', 'female'].includes(value || '')) return 'female';
    return value || '';
  };
  const hasOpposingGenderProfile = (gender: string | null | undefined, category: string) => {
    const normalized = normalizedProfileGender(gender);
    return (
      (category === 'men' && normalized === 'female') ||
      (category === 'women' && normalized === 'male')
    );
  };
  const profileGenderLabel = (gender: string | null | undefined, category: string) =>
    hasOpposingGenderProfile(gender, category) ? `Profile gender: ${gender}` : undefined;
  const availablePairPlayers = useMemo(
    () =>
      [...activeParticipants].sort((a, b) => {
        const aPaired = pairs.some(
          (pair) =>
            pair.status !== 'withdrawn' &&
            pair.category === pairCategory &&
            (pair.player_one_id === a.id || pair.player_two_id === a.id),
        );
        const bPaired = pairs.some(
          (pair) =>
            pair.status !== 'withdrawn' &&
            pair.category === pairCategory &&
            (pair.player_one_id === b.id || pair.player_two_id === b.id),
        );
        const aOpposing = hasOpposingGenderProfile(a.gender, pairCategory);
        const bOpposing = hasOpposingGenderProfile(b.gender, pairCategory);
        return (
          Number(aPaired) - Number(bPaired) ||
          Number(aOpposing) - Number(bOpposing) ||
          a.display_name.localeCompare(b.display_name)
        );
      }),
    [activeParticipants, pairs, pairCategory],
  );
  function pairPlayerRestriction(
    participant: Participant,
    selectedPartnerId: string,
    ignorePairId?: string,
  ) {
    if (participant.category !== pairCategory) return 'Not registered in this category';
    if (participant.id === selectedPartnerId) return 'Already selected as the other player';
    const existingPair = pairs.find(
      (pair) =>
        pair.status !== 'withdrawn' &&
        pair.id !== ignorePairId &&
        pair.category === pairCategory &&
        (pair.player_one_id === participant.id || pair.player_two_id === participant.id),
    );
    if (existingPair)
      return `Already paired with ${existingPair.player_one_id === participant.id ? existingPair.player_two_name : existingPair.player_one_name}`;
    const partner = activeParticipants.find((item) => item.id === selectedPartnerId);
    const gender = participant.gender_override || participant.gender;
    const partnerGender = partner?.gender_override || partner?.gender;
    if (pairCategory === 'mixed' && gender && !isGenderEligibleForCategory('mixed', gender))
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pairCategory === 'mixed' &&
      partnerGender &&
      !isGenderEligibleForCategory('mixed', partnerGender)
    )
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pairCategory === 'mixed' &&
      ['male', 'female'].includes(gender || '') &&
      gender === partnerGender
    )
      return 'Mixed doubles requires different known genders';
    return '';
  }
  function replacementRestriction(participant: Participant, target: { pair: Pair; side: 1 | 2 }) {
    const { pair, side } = target;
    if (participant.id === pair.player_one_id || participant.id === pair.player_two_id)
      return 'Already in this pair';
    if (participant.category !== pair.category) return 'Not registered in this category';
    const paired = pairs.find(
      (other) =>
        other.status !== 'withdrawn' &&
        other.id !== pair.id &&
        other.category === pair.category &&
        (other.player_one_id === participant.id || other.player_two_id === participant.id),
    );
    if (paired)
      return `Already paired with ${paired.player_one_id === participant.id ? paired.player_two_name : paired.player_one_name}`;
    const gender = participant.gender_override || participant.gender;
    const partnerId = side === 1 ? pair.player_two_id : pair.player_one_id;
    const partner = participants.find((item) => item.id === partnerId);
    const partnerGender = partner?.gender_override || partner?.gender;
    if (pair.category === 'mixed' && gender && !isGenderEligibleForCategory('mixed', gender))
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pair.category === 'mixed' &&
      partnerGender &&
      !isGenderEligibleForCategory('mixed', partnerGender)
    )
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pair.category === 'mixed' &&
      ['male', 'female'].includes(gender || '') &&
      gender === partnerGender
    )
      return 'Mixed doubles requires different known genders';
    return '';
  }

  async function runAction(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (result.error) throw new Error(result.error.message);
      setMessage(success);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save tournament changes.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function removeParticipant(participant: Participant) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: participantError } = await db
        .from('tournament_participants')
        .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
        .eq('id', participant.id);
      if (participantError) throw new Error(participantError.message);
      const affectedPairs = pairs.filter(
        (pair) =>
          pair.status !== 'withdrawn' &&
          (pair.player_one_id === participant.id || pair.player_two_id === participant.id),
      );
      const pairIds = affectedPairs.map((pair) => pair.id);
      if (pairIds.length) {
        const { error: pairError } = await db
          .from('tournament_pairs')
          .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
          .in('id', pairIds);
        if (pairError) throw new Error(pairError.message);
        const unplayedMatches = matches.filter(
          (match) =>
            match.status !== 'completed' &&
            match.status !== 'cancelled' &&
            (pairIds.includes(match.pair_one_id || '') ||
              pairIds.includes(match.pair_two_id || '')),
        );
        const matchIds = unplayedMatches.map((match) => match.id);
        if (matchIds.length) {
          const { error: cancelError } = await db
            .from('tournament_matches')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .in('id', matchIds);
          if (cancelError) throw new Error(cancelError.message);
        }
      }
      const historicalOrUpcomingMatches = matches.filter(
        (match) =>
          match.status !== 'completed' &&
          match.status !== 'cancelled' &&
          matchPlayers.some(
            (row) => row.match_id === match.id && row.participant_id === participant.id,
          ),
      );
      if (historicalOrUpcomingMatches.length) {
        const { error: playerError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('participant_id', participant.id)
          .in(
            'match_id',
            historicalOrUpcomingMatches.map((match) => match.id),
          );
        if (playerError) throw new Error(playerError.message);
      }
      setMessage(
        `${participant.display_name} withdrawn. Completed match history has been preserved.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove participant.');
    } finally {
      setBusy(false);
    }
  }

  async function addParticipant(e: FormEvent) {
    e.preventDefault();
    const selected = members.find((m) => m.id === memberId);
    if (leagueTournament && !selected) {
      setError('Select an eligible active member for this League event.');
      return;
    }
    if (leagueTournament && selected && leagueMemberEligibility[selected.id] !== true) {
      setError('An active paid membership is required to join a League event.');
      return;
    }
    const targetCategory = isTeam
      ? 'team'
      : leagueTournament
        ? leagueGender === 'male'
          ? 'men'
          : 'women'
        : activeCategory;
    if (
      leagueTournament &&
      selected &&
      !isTeam &&
      hasOpposingGenderProfile(selected.gender, targetCategory)
    ) {
      setError('This player’s profile gender does not match the selected doubles category.');
      return;
    }
    if (!selected && !participantName.trim()) {
      setError('Enter a participant name or select a member.');
      return;
    }
    const registrationGender = selected?.gender || participantGender || null;
    const emailKey = (selected?.email || participantEmail).trim().toLowerCase();
    const oppositeCategory =
      targetCategory === 'men' ? 'women' : targetCategory === 'women' ? 'men' : null;
    const oppositeEntry =
      oppositeCategory &&
      participants.find(
        (participant) =>
          participant.status === 'registered' &&
          participant.category === oppositeCategory &&
          (selected
            ? participant.user_id === selected.id
            : !!emailKey && participant.email?.trim().toLowerCase() === emailKey),
      );
    if (oppositeEntry) {
      setError(
        `This player is already registered for ${oppositeCategory === 'men' ? "men's" : "women's"} doubles and cannot enter both categories.`,
      );
      return;
    }
    if (leagueTournament && selected) {
      if (!leagueId) {
        setError('League configuration could not be found.');
        return;
      }
      const { data: leagueTeam, error: teamError } = await db
        .from('league_teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('status', 'active')
        .or(`player_one_id.eq.${selected.id},player_two_id.eq.${selected.id}`)
        .maybeSingle();
      if (teamError) {
        setError(teamError.message);
        return;
      }
      if (leagueTeam) {
        const { error: registrationError } = await db.rpc('register_league_event_team', {
          p_event_id: eventId,
          p_member_id: selected.id,
        });
        if (registrationError) {
          setError(registrationError.message);
          return;
        }
        setMessage(`${selected.full_name} and their confirmed League partner registered.`);
        setMemberId('');
        await refresh();
        return;
      }
    }
    await runAction(
      () =>
        db.from('tournament_participants').insert({
          event_id: eventId,
          user_id: selected?.id ?? null,
          category: targetCategory,
          amount_cents: priceCents,
          payment_status: priceCents > 0 ? 'pending' : 'not_required',
          display_name: selected?.full_name || participantName.trim(),
          email: selected?.email || participantEmail.trim() || null,
          phone: participantPhone.trim() || null,
          gender: registrationGender,
        }),
      'Participant added.',
    );
    setMemberId('');
    setParticipantName('');
    setParticipantEmail('');
    setParticipantPhone('');
    setParticipantGender('');
  }
  async function addTeam(e: FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    await runAction(
      () =>
        db.from('tournament_teams').insert({
          event_id: eventId,
          name: teamName.trim(),
          color: teamColor.trim(),
          logo_url: teamLogo.trim() || null,
          captain_user_id: captain || null,
        }),
      'Team created.',
    );
    setTeamName('');
    setTeamColor('');
    setTeamLogo('');
    setCaptain('');
  }
  async function createPair(e: FormEvent) {
    e.preventDefault();
    if (!pairOne || !pairTwo || pairOne === pairTwo) return;
    const a = participants.find((p) => p.id === pairOne);
    const b = participants.find((p) => p.id === pairTwo);
    const genderOf = (p?: Participant) => p?.gender_override || p?.gender;
    if (a?.category !== pairCategory || b?.category !== pairCategory) {
      setError(
        'Each participant must have a registration in the selected category before pairing.',
      );
      return;
    }
    if (
      pairCategory === 'mixed' &&
      [genderOf(a), genderOf(b)].some(
        (gender) => !!gender && !isGenderEligibleForCategory('mixed', gender),
      )
    ) {
      setError('Mixed doubles requires male/female gender when gender is specified.');
      return;
    }
    if (
      pairCategory === 'mixed' &&
      genderOf(a) &&
      genderOf(b) &&
      ['male', 'female'].includes((genderOf(a) || '').trim().toLowerCase()) &&
      (genderOf(a) || '').trim().toLowerCase() === (genderOf(b) || '').trim().toLowerCase()
    ) {
      setError(
        'Mixed doubles requires one male and one female player when both gender fields are known.',
      );
      return;
    }
    await runAction(
      () =>
        db.from('tournament_pairs').insert({
          event_id: eventId,
          category: pairCategory,
          player_one_id: pairOne,
          player_two_id: pairTwo,
        }),
      'Doubles pair created.',
    );
    setPairOne('');
    setPairTwo('');
  }
  async function replacePairPlayer(pair: Pair, side: 1 | 2): Promise<boolean> {
    const replacementId = replacementParticipantId;
    const oldId = side === 1 ? pair.player_one_id : pair.player_two_id;
    if (!replacementId || replacementId === oldId) {
      setError('Select a different replacement participant.');
      return false;
    }
    if (replacementId === (side === 1 ? pair.player_two_id : pair.player_one_id)) {
      setError('The same participant cannot occupy both positions in a pair.');
      return false;
    }
    const existing = pairs.some(
      (other) =>
        other.status !== 'withdrawn' &&
        other.id !== pair.id &&
        other.category === pair.category &&
        (other.player_one_id === replacementId || other.player_two_id === replacementId),
    );
    const oldStillAssigned = pairs.some(
      (other) =>
        other.status !== 'withdrawn' &&
        other.id !== pair.id &&
        other.category === pair.category &&
        (other.player_one_id === oldId || other.player_two_id === oldId),
    );
    if (oldStillAssigned) {
      setError(
        'This player is assigned to another pair in the same category; update that draw before replacing them.',
      );
      return false;
    }
    if (existing) {
      setError('This participant is already assigned to another pair in this category.');
      return false;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (leagueTournament) {
        const { error: replacementError } = await db.rpc('replace_league_team_member', {
          p_event_id: eventId,
          p_pair_id: pair.id,
          p_side: side,
          p_replacement_participant_id: replacementId,
        });
        if (replacementError) throw new Error(replacementError.message);
        setMessage(
          'League team updated. Future event pairs use the replacement; completed match records keep the players who played.',
        );
        await refresh();
        return true;
      }
      const changes =
        side === 1 ? { player_one_id: replacementId } : { player_two_id: replacementId };
      const { error: pairError } = await db
        .from('tournament_pairs')
        .update(changes)
        .eq('id', pair.id);
      if (pairError) throw new Error(pairError.message);
      const { error: participantError } = await db
        .from('tournament_participants')
        .update({
          status: 'replaced',
          replaced_by: replacementId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', oldId);
      if (participantError) throw new Error(participantError.message);
      for (const match of matches.filter(
        (m) =>
          (m.pair_one_id === pair.id || m.pair_two_id === pair.id) &&
          m.status !== 'completed' &&
          m.status !== 'cancelled',
      )) {
        const matchSide = match.pair_one_id === pair.id ? 1 : 2;
        const { error: deleteError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('match_id', match.id)
          .eq('side', matchSide);
        if (deleteError) throw new Error(deleteError.message);
        const updatedPair = { ...pair, ...changes };
        const { error: insertError } = await db.from('tournament_match_players').insert([
          {
            match_id: match.id,
            participant_id: updatedPair.player_one_id,
            side: matchSide,
            team_id: null,
          },
          {
            match_id: match.id,
            participant_id: updatedPair.player_two_id,
            side: matchSide,
            team_id: null,
          },
        ]);
        if (insertError) throw new Error(insertError.message);
      }
      setMessage(
        'Pair replacement saved. Completed matches retain the players who actually played; future matches use the replacement.',
      );
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not replace participant.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveTeamPairing(match: Match, teamId: string, side: 1 | 2) {
    if (match.status === 'completed' || match.status === 'cancelled') {
      setError('Completed match pairings are preserved as historical records.');
      return;
    }
    const selection = teamPairSelection[`${match.id}-${side}`];
    const currentPair = matchPlayers.filter(
      (player) => player.match_id === match.id && player.team_id === teamId,
    );
    const first = selection?.first ?? currentPair[0]?.participant_id ?? '';
    const second = selection?.second ?? currentPair[1]?.participant_id ?? '';
    if (!first || !second || first === second) {
      setError('Select two different players from the same team.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: deleteError } = await db
        .from('tournament_match_players')
        .delete()
        .eq('match_id', match.id)
        .eq('team_id', teamId);
      if (deleteError) throw new Error(deleteError.message);
      const { error: insertError } = await db.from('tournament_match_players').insert([
        { match_id: match.id, participant_id: first, side, team_id: teamId },
        { match_id: match.id, participant_id: second, side, team_id: teamId },
      ]);
      if (insertError) throw new Error(insertError.message);
      setMessage('Team doubles pairing saved.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save team pairing.');
    } finally {
      setBusy(false);
    }
  }

  async function createMatch(e: FormEvent) {
    e.preventDefault();
    const teamMatch = format === 'team';
    const firstSlot = matchOne.startsWith('slot:') ? matchOne.slice(5) : null;
    const secondSlot = matchTwo.startsWith('slot:') ? matchTwo.slice(5) : null;
    const firstIsBye = matchOne === 'bye';
    const secondIsBye = matchTwo === 'bye';
    const byeSide = firstIsBye ? 1 : secondIsBye ? 2 : null;
    const firstId = firstSlot || firstIsBye ? null : matchOne;
    const secondId = secondSlot || secondIsBye ? null : matchTwo;
    if (!matchOne || !matchTwo || matchOne === matchTwo) {
      setError('Select two different sides.');
      return;
    }
    if (byeSide && (!matchPhase.includes('knockout') || (firstIsBye && secondIsBye))) {
      setError('BYE can only be used once in a knockout match.');
      return;
    }
    const byeOpposingSideSelected =
      byeSide === 1 ? !!(secondId || secondSlot) : byeSide === 2 ? !!(firstId || firstSlot) : false;
    if (byeSide && !byeOpposingSideSelected) {
      setError('Select a player pair, team, or defined group slot opposite BYE.');
      return;
    }
    if ((firstSlot || secondSlot) && !matchPhase.includes('knockout')) {
      setError('Group placeholder slots can only be used in knockout matches.');
      return;
    }
    if (matchTime && !byeSide && !isValidSchedule(matchTime)) return;
    const inferredGroup = isTeam
      ? teams.find((t) => t.id === firstId)?.group_number
      : pairs.find((p) => p.id === firstId)?.group_number;
    const secondGroup = isTeam
      ? teams.find((t) => t.id === secondId)?.group_number
      : pairs.find((p) => p.id === secondId)?.group_number;
    if (
      !byeSide &&
      matchPhase.includes('round_robin') &&
      (!inferredGroup || !secondGroup || inferredGroup !== secondGroup)
    ) {
      setError('Round-robin matches must be between two entries assigned to the same group.');
      return;
    }
    const payload: Record<string, unknown> = {
      event_id: eventId,
      category: matchCategory,
      phase: matchPhase,
      group_number: matchPhase.includes('round_robin') ? (inferredGroup ?? null) : null,
      scheduled_at: byeSide ? null : matchTime ? new Date(matchTime).toISOString() : null,
      court_number: byeSide ? null : matchCourt ? Number(matchCourt) : null,
      status: byeSide ? 'bye' : 'scheduled',
      winner_side: byeSide === 1 ? 2 : byeSide === 2 ? 1 : null,
      match_number:
        matches.filter((m) => m.phase === matchPhase && m.category === matchCategory).length + 1,
      notes: JSON.stringify({ slot_one: firstSlot, slot_two: secondSlot }),
    };
    if (teamMatch) {
      payload.team_one_id = firstId;
      payload.team_two_id = secondId;
    } else {
      payload.pair_one_id = firstId;
      payload.pair_two_id = secondId;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data: createdMatch, error: createError } = await db
        .from('tournament_matches')
        .insert(payload)
        .select('id')
        .single();
      if (createError || !createdMatch)
        throw new Error(createError?.message || 'Could not create match.');
      if (!teamMatch) {
        const firstPair = firstId ? pairs.find((pair) => pair.id === firstId) : null;
        const secondPair = secondId ? pairs.find((pair) => pair.id === secondId) : null;
        const playerAssignments = [
          ...(firstPair
            ? [
                {
                  match_id: createdMatch.id,
                  participant_id: firstPair.player_one_id,
                  side: 1,
                  team_id: null,
                },
                {
                  match_id: createdMatch.id,
                  participant_id: firstPair.player_two_id,
                  side: 1,
                  team_id: null,
                },
              ]
            : []),
          ...(secondPair
            ? [
                {
                  match_id: createdMatch.id,
                  participant_id: secondPair.player_one_id,
                  side: 2,
                  team_id: null,
                },
                {
                  match_id: createdMatch.id,
                  participant_id: secondPair.player_two_id,
                  side: 2,
                  team_id: null,
                },
              ]
            : []),
        ];
        if (playerAssignments.length) {
          const { error: playersError } = await db
            .from('tournament_match_players')
            .insert(playerAssignments);
          if (playersError) {
            await db.from('tournament_matches').delete().eq('id', createdMatch.id);
            throw new Error(playersError.message);
          }
        }
      }
      setMessage('Match created.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create match.');
    } finally {
      setBusy(false);
    }
    setMatchTime('');
    setMatchCourt('');
  }
  function isValidSchedule(value: string) {
    const scheduled = new Date(value);
    const start = new Date(eventStartsAt);
    const end = new Date(eventEndsAt || eventStartsAt);
    if (Number.isNaN(scheduled.getTime()) || scheduled < start || scheduled > end) {
      setError('Match time must fall within the tournament dates.');
      return false;
    }
    if (
      scheduled.getHours() < 8 ||
      scheduled.getHours() > 21 ||
      (scheduled.getHours() === 21 && scheduled.getMinutes() > 0)
    ) {
      setError('Matches may start no earlier than 8:00 AM and no later than 9:00 PM.');
      return false;
    }
    setError('');
    return true;
  }
  function participantIdsForMatch(candidate: Match) {
    const assigned = matchPlayers
      .filter((player) => player.match_id === candidate.id)
      .map((player) => player.participant_id);
    const participantIds = assigned.length
      ? assigned
      : !isTeam
        ? (() => {
            const one = pairs.find((pair) => pair.id === candidate.pair_one_id);
            const two = pairs.find((pair) => pair.id === candidate.pair_two_id);
            return [
              one?.player_one_id,
              one?.player_two_id,
              two?.player_one_id,
              two?.player_two_id,
            ].filter((id): id is string => !!id);
          })()
        : [];
    return new Set(
      participantIds.map((id) => {
        const participant = participants.find((item) => item.id === id);
        if (participant?.user_id) return `user:${participant.user_id}`;
        if (participant?.email?.trim()) return `email:${participant.email.trim().toLowerCase()}`;
        return `participant:${id}`;
      }),
    );
  }
  async function saveMatch(match: Match, changes: Partial<Match>): Promise<boolean> {
    if (changes.scheduled_at && !isValidSchedule(localDateTime(changes.scheduled_at))) return false;
    if (changes.scheduled_at || changes.court_number !== undefined) {
      const proposedScheduledAt = changes.scheduled_at ?? match.scheduled_at;
      if (!proposedScheduledAt)
        return runAction(
          () =>
            db
              .from('tournament_matches')
              .update({ ...changes, updated_at: new Date().toISOString() })
              .eq('id', match.id),
          changes.score_sets ? '' : 'Match updated.',
        );
      const start = new Date(proposedScheduledAt).getTime();
      const court = changes.court_number ?? match.court_number;
      const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60));
      const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15));
      const proposedPlayers = participantIdsForMatch(match);
      const conflicts = matches.filter((other) => {
        if (other.id === match.id || other.status === 'cancelled' || !other.scheduled_at)
          return false;
        const otherStart = new Date(other.scheduled_at).getTime();
        const courtConflict =
          !!court &&
          other.court_number === court &&
          start < otherStart + (duration + gap) * 60000 &&
          otherStart < start + (duration + gap) * 60000;
        const otherPlayers = participantIdsForMatch(other);
        const playerConflict =
          [...proposedPlayers].some((id) => otherPlayers.has(id)) &&
          start < otherStart + (duration + gap) * 60000 &&
          otherStart < start + (duration + gap) * 60000;
        return courtConflict || playerConflict;
      });
      if (conflicts.length) {
        setPendingScheduleConflicts({
          match,
          changes,
          conflicts: conflicts.sort(
            (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
          ),
        });
        return false;
      }
    }
    return runAction(
      () =>
        db
          .from('tournament_matches')
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq('id', match.id),
      changes.score_sets ? '' : 'Match updated.',
    );
  }
  async function confirmResolveScheduleConflicts() {
    if (!pendingScheduleConflicts) return;
    const { match, changes, conflicts } = pendingScheduleConflicts;
    setPendingScheduleConflicts(null);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const targetStart = new Date(changes.scheduled_at ?? match.scheduled_at ?? '').getTime();
      const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60));
      const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15));
      const court = changes.court_number ?? match.court_number;
      const { error: targetError } = await db
        .from('tournament_matches')
        .update({ ...changes, updated_at: new Date().toISOString() })
        .eq('id', match.id);
      if (targetError) throw new Error(targetError.message);
      let cursor = targetStart + (duration + gap) * 60000;
      const end = new Date(eventEndsAt || eventStartsAt).getTime();
      for (const conflict of conflicts) {
        const conflictCourt = court ?? conflict.court_number;
        let next = new Date(cursor);
        if (next.getHours() >= 21 || next.getHours() < 8) {
          next.setDate(next.getDate() + (next.getHours() >= 21 ? 1 : 0));
          next.setHours(8, 0, 0, 0);
        }
        while (
          next.getTime() + duration * 60000 > end ||
          matches.some((other) => {
            if (
              other.id === conflict.id ||
              other.id === match.id ||
              !other.scheduled_at ||
              other.status === 'cancelled'
            )
              return false;
            const otherStart = new Date(other.scheduled_at).getTime();
            const courtConflict =
              other.court_number === conflictCourt &&
              !!conflictCourt &&
              next.getTime() < otherStart + (duration + gap) * 60000 &&
              otherStart < next.getTime() + (duration + gap) * 60000;
            const nextPlayers = participantIdsForMatch(conflict);
            const otherPlayers = participantIdsForMatch(other);
            const playerConflict =
              [...nextPlayers].some((id) => otherPlayers.has(id)) &&
              next.getTime() < otherStart + (duration + gap) * 60000 &&
              otherStart < next.getTime() + (duration + gap) * 60000;
            return courtConflict || playerConflict;
          })
        ) {
          next = new Date(next.getTime() + 15 * 60000);
          if (next.getHours() >= 21) {
            next.setDate(next.getDate() + 1);
            next.setHours(8, 0, 0, 0);
          }
          if (next.getTime() + duration * 60000 > end)
            throw new Error(
              'Conflicting matches cannot all be moved within the tournament dates. Extend the tournament dates or move matches manually.',
            );
        }
        const { error: shiftError } = await db
          .from('tournament_matches')
          .update({
            scheduled_at: next.toISOString(),
            court_number: conflictCourt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conflict.id);
        if (shiftError) throw new Error(shiftError.message);
        cursor = next.getTime() + (duration + gap) * 60000;
      }
      setMessage(
        `Moved ${conflicts.length} conflicting match${conflicts.length === 1 ? '' : 'es'} to avoid overlap.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resolve schedule conflicts.');
    } finally {
      setBusy(false);
    }
  }
  async function changeMatchSide(match: Match, side: 1 | 2, newId: string) {
    if (!newId || match.status === 'completed') return;
    const teamMatch = format === 'team';
    const isByeSelection = newId === 'bye';
    const slotLabel = newId.startsWith('slot:') ? newId.slice(5) : null;
    const selectedId = slotLabel || isByeSelection ? null : newId;
    const field = teamMatch
      ? side === 1
        ? 'team_one_id'
        : 'team_two_id'
      : side === 1
        ? 'pair_one_id'
        : 'pair_two_id';
    const otherId = teamMatch
      ? side === 1
        ? match.team_two_id
        : match.team_one_id
      : side === 1
        ? match.pair_two_id
        : match.pair_one_id;
    let otherSlotLabel: string | null = null;
    try {
      const otherNotes = JSON.parse(match.notes || '{}') as {
        slot_one?: string | null;
        slot_two?: string | null;
      };
      otherSlotLabel = side === 1 ? (otherNotes.slot_two ?? null) : (otherNotes.slot_one ?? null);
    } catch {
      otherSlotLabel = null;
    }
    const otherIsBye = matchSideValue(match, side === 1 ? 2 : 1) === 'bye';
    if ((selectedId && selectedId === otherId) || (slotLabel && slotLabel === otherSlotLabel)) {
      setError('A match must have two different sides.');
      return;
    }
    if (
      isByeSelection &&
      (!match.phase.includes('knockout') || otherIsBye || (!otherId && !otherSlotLabel))
    ) {
      setError('BYE can only be assigned once in a knockout match with an opposing side selected.');
      return;
    }
    if (match.phase.includes('round_robin') && selectedId) {
      const selectedGroup = teamMatch
        ? teams.find((team) => team.id === selectedId)?.group_number
        : pairs.find((pair) => pair.id === selectedId)?.group_number;
      const otherGroup = teamMatch
        ? teams.find((team) => team.id === otherId)?.group_number
        : pairs.find((pair) => pair.id === otherId)?.group_number;
      if (!selectedGroup || selectedGroup !== otherGroup) {
        setError('Round-robin matches must be between entries in the same group.');
        return;
      }
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let notes: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(match.notes || '{}') as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') notes = parsed;
      } catch {
        notes = {};
      }
      notes[side === 1 ? 'slot_one' : 'slot_two'] = slotLabel;
      const { error: updateError } = await db
        .from('tournament_matches')
        .update({
          [field]: selectedId,
          status:
            isByeSelection || otherIsBye
              ? 'bye'
              : match.status === 'bye'
                ? 'scheduled'
                : match.status,
          winner_side: isByeSelection
            ? side === 1
              ? 2
              : 1
            : otherIsBye
              ? side
              : match.status === 'bye'
                ? null
                : match.winner_side,
          scheduled_at:
            isByeSelection || otherIsBye
              ? null
              : match.status === 'bye'
                ? null
                : match.scheduled_at,
          court_number:
            isByeSelection || otherIsBye
              ? null
              : match.status === 'bye'
                ? null
                : match.court_number,
          score_sets:
            isByeSelection || otherIsBye || match.status === 'bye' ? [] : match.score_sets,
          notes: JSON.stringify(notes),
          updated_at: new Date().toISOString(),
        })
        .eq('id', match.id);
      if (updateError) throw new Error(updateError.message);
      if (!teamMatch) {
        const { error: deleteError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('match_id', match.id)
          .eq('side', side);
        if (deleteError) throw new Error(deleteError.message);
        const pair = selectedId ? pairs.find((item) => item.id === selectedId) : null;
        if (pair) {
          const { error: insertError } = await db.from('tournament_match_players').insert([
            { match_id: match.id, participant_id: pair.player_one_id, side, team_id: null },
            { match_id: match.id, participant_id: pair.player_two_id, side, team_id: null },
          ]);
          if (insertError) throw new Error(insertError.message);
        }
      }
      setMessage('Match draw updated.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update match draw.');
    } finally {
      setBusy(false);
    }
  }
  async function generateSchedule() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const phase = matchPhase;
      const category = isTeam ? 'team' : activeCategory;
      let currentMatches = [...matches];
      if (phase === 'round_robin' || phase === 'team_round_robin') {
        const sides = (
          isTeam
            ? teams
            : pairs.filter(
                (pair) => pair.status !== 'withdrawn' && pair.category === activeCategory,
              )
        ).filter(
          (side, index, all) => all.findIndex((candidate) => candidate.id === side.id) === index,
        );
        const groups = new Map<number, Array<(typeof sides)[number]>>();
        for (const side of sides) {
          const groupNumber = side.group_number;
          if (!groupNumber) continue;
          groups.set(groupNumber, [...(groups.get(groupNumber) ?? []), side]);
        }
        if (sides.some((side) => !side.group_number)) {
          throw new Error(
            'Assign every team or doubles pair to a group before suggesting the round-robin schedule.',
          );
        }
        const existing = currentMatches.filter(
          (m) => m.category === category && m.phase === phase && m.status !== 'cancelled',
        );
        const rows: Record<string, unknown>[] = [];
        const keyFor = (a: string, b: string, group: number) => [group, ...[a, b].sort()].join(':');
        const existingKeys = new Set(
          existing.map((m) =>
            keyFor(
              (isTeam ? m.team_one_id : m.pair_one_id) || '',
              (isTeam ? m.team_two_id : m.pair_two_id) || '',
              m.group_number ?? 0,
            ),
          ),
        );
        for (const [groupNumber, groupSides] of groups) {
          for (let i = 0; i < groupSides.length; i++) {
            for (let j = i + 1; j < groupSides.length; j++) {
              const one = groupSides[i];
              const two = groupSides[j];
              const matchupKey = keyFor(one.id, two.id, groupNumber);
              if (existingKeys.has(matchupKey)) continue;
              existingKeys.add(matchupKey);
              rows.push({
                event_id: eventId,
                category,
                phase,
                group_number: groupNumber,
                round_number: 1,
                match_number: existing.length + rows.length + 1,
                status: 'scheduled',
                ...(isTeam
                  ? { team_one_id: one.id, team_two_id: two.id }
                  : { pair_one_id: one.id, pair_two_id: two.id }),
              });
            }
          }
        }
        if (rows.length) {
          const { data: created, error: insertError } = await db
            .from('tournament_matches')
            .insert(rows)
            .select('*');
          if (insertError) throw new Error(insertError.message);
          const createdMatches = (created ?? []) as Match[];
          if (!isTeam && createdMatches.length) {
            const assignments = createdMatches.flatMap((match) => {
              const one = pairs.find((pair) => pair.id === match.pair_one_id);
              const two = pairs.find((pair) => pair.id === match.pair_two_id);
              return one && two
                ? [
                    {
                      match_id: match.id,
                      participant_id: one.player_one_id,
                      side: 1,
                      team_id: null,
                    },
                    {
                      match_id: match.id,
                      participant_id: one.player_two_id,
                      side: 1,
                      team_id: null,
                    },
                    {
                      match_id: match.id,
                      participant_id: two.player_one_id,
                      side: 2,
                      team_id: null,
                    },
                    {
                      match_id: match.id,
                      participant_id: two.player_two_id,
                      side: 2,
                      team_id: null,
                    },
                  ]
                : [];
            });
            if (assignments.length) {
              const { error: playerError } = await db
                .from('tournament_match_players')
                .insert(assignments);
              if (playerError) throw new Error(playerError.message);
            }
          }
          currentMatches = [...currentMatches, ...createdMatches];
        }
      }
      const pending = currentMatches.filter(
        (m) =>
          m.category === category &&
          m.phase === phase &&
          m.status !== 'cancelled' &&
          !m.scheduled_at,
      );
      const end = new Date(eventEndsAt || eventStartsAt);
      const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60));
      const breakMinutes = Math.max(10, Number(config?.schedule?.break_minutes ?? 15));
      // Sequence phases from the end of every prerequisite match, then leave at
      // least one full hour before the next phase starts. This intentionally uses
      // the latest match across the whole preceding phase, not the first round.
      const prerequisitePhases =
        phase === 'round_robin' || phase === 'team_round_robin'
          ? ['preliminary_knockout']
          : phase === 'final_knockout'
            ? ['preliminary_knockout', 'round_robin']
            : phase === 'team_knockout'
              ? ['preliminary_knockout', 'team_round_robin']
              : [];
      const prerequisiteMatches = currentMatches.filter(
        (m) =>
          prerequisitePhases.includes(m.phase) &&
          m.category === category &&
          m.status !== 'cancelled',
      );
      const phaseStart = phaseStartAfterPrerequisites({
        baseStart: eventStartsAt,
        prerequisiteMatches,
        matchMinutes: duration,
        minimumBreakMinutes: 60,
      });
      const occupiedMatches = currentMatches.filter(
        (m) => m.scheduled_at && m.status !== 'cancelled',
      );
      const scheduled: Array<{ id: string; scheduled_at: string; court_number: number }> = [];
      for (const match of pending) {
        let cursor = new Date(phaseStart.getTime());
        cursor.setHours(
          Math.max(8, cursor.getHours()),
          cursor.getHours() < 8 ? 0 : cursor.getMinutes(),
          0,
          0,
        );
        let assigned: { scheduled_at: string; court_number: number } | null = null;
        let guard = 0;
        while (!assigned && guard++ < 4000) {
          if (cursor.getHours() < 8) cursor.setHours(8, 0, 0, 0);
          if (
            cursor.getHours() > 21 ||
            (cursor.getHours() === 21 && cursor.getMinutes() > 0) ||
            cursor.getTime() + duration * 60000 > end.getTime()
          ) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(8, 0, 0, 0);
            continue;
          }
          for (let court = 1; court <= Math.max(1, courtCount); court++) {
            const scheduledMap = new Map(scheduled.map((item) => [item.id, item.scheduled_at]));
            const candidatePlayers = participantIdsForMatch(match);
            const hasConflict = [
              ...occupiedMatches,
              ...scheduled.map(
                (item) =>
                  ({
                    ...currentMatches.find((m) => m.id === item.id)!,
                    ...item,
                    status: 'scheduled',
                  }) as Match,
              ),
            ].some((other) => {
              if (!other.scheduled_at || other.id === match.id) return false;
              const otherStart = new Date(
                scheduledMap.get(other.id) ?? other.scheduled_at,
              ).getTime();
              const sameCourtOverlap =
                other.court_number === court &&
                cursor.getTime() < otherStart + (duration + breakMinutes) * 60000 &&
                otherStart < cursor.getTime() + (duration + breakMinutes) * 60000;
              const otherPlayers = participantIdsForMatch(other);
              const playerOverlap =
                [...candidatePlayers].some((id) => otherPlayers.has(id)) &&
                cursor.getTime() < otherStart + (duration + breakMinutes) * 60000 &&
                otherStart < cursor.getTime() + (duration + breakMinutes) * 60000;
              return sameCourtOverlap || playerOverlap;
            });
            if (!hasConflict) {
              assigned = { scheduled_at: cursor.toISOString(), court_number: court };
              break;
            }
          }
          if (!assigned) cursor = new Date(cursor.getTime() + 15 * 60000);
        }
        if (!assigned)
          throw new Error(
            'Not enough available time within the tournament boundaries. Extend the event or reduce the number of matches.',
          );
        scheduled.push({ id: match.id, ...assigned });
      }
      for (const item of scheduled) {
        const { error: updateError } = await db
          .from('tournament_matches')
          .update({ scheduled_at: item.scheduled_at, court_number: item.court_number })
          .eq('id', item.id);
        if (updateError) throw new Error(updateError.message);
      }
      setMessage(
        `${scheduled.length} matches scheduled${phase.includes('round_robin') ? '; all group matchups were generated where missing' : ''}. Review and edit them below.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not suggest a schedule.');
    } finally {
      setBusy(false);
    }
  }
  async function syncUnplayedRoundRobinMatches() {
    const category = isTeam ? 'team' : activeCategory;
    const phase = isTeam ? 'team_round_robin' : 'round_robin';
    const entryResult = isTeam
      ? await db.from('tournament_teams').select('id,group_number').eq('event_id', eventId)
      : await db
          .from('tournament_pairs')
          .select('id,group_number')
          .eq('event_id', eventId)
          .eq('category', activeCategory)
          .neq('status', 'withdrawn');
    if (entryResult.error) return { error: entryResult.error };
    const matchResult = await db
      .from('tournament_matches')
      .select('*')
      .eq('event_id', eventId)
      .eq('category', category)
      .eq('phase', phase);
    if (matchResult.error) return { error: matchResult.error };
    const groupById = new Map(
      (entryResult.data ?? []).map(
        (entry: { id: string; group_number: number | null }) =>
          [entry.id, entry.group_number] as const,
      ),
    );
    for (const match of (matchResult.data ?? []) as Match[]) {
      if (
        match.status === 'completed' ||
        match.status === 'cancelled' ||
        match.winner_side != null ||
        (match.score_sets?.length ?? 0) > 0
      )
        continue;
      const oneId = isTeam ? match.team_one_id : match.pair_one_id;
      const twoId = isTeam ? match.team_two_id : match.pair_two_id;
      const oneGroup = oneId ? groupById.get(oneId) : null;
      const twoGroup = twoId ? groupById.get(twoId) : null;
      const sameGroup = !!oneGroup && oneGroup === twoGroup;
      const { error } = await db
        .from('tournament_matches')
        .update({
          group_number: sameGroup ? oneGroup : null,
          status: sameGroup ? match.status : 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', match.id);
      if (error) return { error };
    }
    return { error: null };
  }

  async function saveEntryGroup(entryId: string, groupNumber: number | null) {
    // Update only the field shared by both entry tables.
    const changes = { group_number: groupNumber };
    const result = isTeam
      ? await db.from('tournament_teams').update(changes).eq('id', entryId)
      : await db
          .from('tournament_pairs')
          .update(changes)
          .eq('id', entryId)
          .eq('category', activeCategory);
    if (result.error) return { error: result.error };
    return syncUnplayedRoundRobinMatches();
  }

  async function randomizeGroups() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const groupCount = Math.max(1, Number(config?.group_count ?? 2));
      const shuffled = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
      if (isTeam) {
        const draw = shuffled(teams);
        for (let index = 0; index < draw.length; index++) {
          const { error: updateError } = await db
            .from('tournament_teams')
            .update({ group_number: (index % groupCount) + 1 })
            .eq('id', draw[index].id);
          if (updateError) throw new Error(updateError.message);
        }
      } else {
        const draw = shuffled(
          pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory),
        );
        for (let index = 0; index < draw.length; index++) {
          const { error: updateError } = await db
            .from('tournament_pairs')
            .update({ group_number: (index % groupCount) + 1 })
            .eq('id', draw[index].id);
          if (updateError) throw new Error(updateError.message);
        }
      }
      const syncResult = await syncUnplayedRoundRobinMatches();
      if (syncResult.error) throw new Error(syncResult.error.message);
      setMessage(
        'Random draw assigned entries as evenly as possible. Unplayed round-robin matches were reconciled with the new groups; completed results were preserved.',
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not randomize groups.');
    } finally {
      setBusy(false);
    }
  }
  async function syncPromotedKnockoutEntrants() {
    const category = isTeam ? 'team' : activeCategory;
    const knockoutPhase = isTeam ? 'team_knockout' : 'final_knockout';
    const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
    const roundRobinEnabled = isTeam
      ? enabledPhases.team_round_robin !== false
      : enabledPhases.round_robin !== false;
    if (!roundRobinEnabled) return;
    const entrants: Array<Team | Pair> = isTeam
      ? teams
      : pairs.filter((pair) => pair.category === activeCategory && pair.status !== 'withdrawn');
    if (!entrants.length) return;
    const { data: roundRobinRows, error: roundRobinError } = await db
      .from('tournament_matches')
      .select('*')
      .eq('event_id', eventId)
      .eq('category', category)
      .eq('phase', roundRobinPhase)
      .neq('status', 'cancelled');
    if (roundRobinError) throw new Error(roundRobinError.message);
    const roundRobinMatches = (roundRobinRows ?? []) as Match[];
    const { data: rankingOverrideRows, error: rankingOverrideError } = await db
      .from('tournament_group_overrides')
      .select('entry_id,override_value,override_type,category,group_number')
      .eq('event_id', eventId)
      .eq('category', category);
    if (rankingOverrideError) throw new Error(rankingOverrideError.message);
    const persistedOverrides = (rankingOverrideRows ?? []) as Array<{
      entry_id: string;
      override_value: number;
      override_type: 'ranking' | 'promotion';
      category: string;
      group_number: number;
    }>;
    const groups = [
      ...new Set(entrants.map((entry) => entry.group_number).filter((n): n is number => n != null)),
    ];
    const rankedByGroup = new Map<number, Array<{ id: string; name: string }>>();
    for (const groupNumber of groups) {
      const groupEntrants = entrants.filter((entry) => entry.group_number === groupNumber);
      const groupMatches = roundRobinMatches.filter((match) => match.group_number === groupNumber);
      const expectedMatches = (groupEntrants.length * (groupEntrants.length - 1)) / 2;
      if (
        !expectedMatches ||
        groupMatches.filter((match) => match.status === 'completed' || match.winner_side != null)
          .length < expectedMatches
      )
        continue;
      const stats = groupEntrants.map((entry) => {
        const id = entry.id;
        const row = {
          id,
          name: ('name' in entry ? entry.name : entry.player_one_name) ?? '',
          wins: 0,
          points: 0,
          setsWon: 0,
          setsLost: 0,
          gamesWon: 0,
          gamesLost: 0,
        };
        for (const match of groupMatches) {
          const oneId = isTeam ? match.team_one_id : match.pair_one_id;
          const twoId = isTeam ? match.team_two_id : match.pair_two_id;
          if (oneId !== id && twoId !== id) continue;
          if (
            (match.winner_side === 1 && oneId === id) ||
            (match.winner_side === 2 && twoId === id)
          )
            row.wins++;
          if (isTeam)
            row.points +=
              oneId === id
                ? Number(match.team_points_one ?? 0)
                : Number(match.team_points_two ?? 0);
          for (const set of match.score_sets ?? []) {
            const own = oneId === id ? set.one : set.two;
            const against = oneId === id ? set.two : set.one;
            row.setsWon += own > against ? 1 : 0;
            row.setsLost += own < against ? 1 : 0;
            row.gamesWon += own;
            row.gamesLost += against;
          }
        }
        return row;
      });
      const priority =
        config?.ranking_priority ??
        (isTeam
          ? ['points', 'matches_won', 'sets_won', 'games_won', 'set_difference', 'game_difference']
          : ['matches_won', 'sets_won', 'games_won', 'set_difference', 'game_difference']);
      stats.sort((a, b) => {
        for (const key of priority) {
          if (key === 'head_to_head') {
            const direct = groupMatches.find((match) => {
              const oneId = isTeam ? match.team_one_id : match.pair_one_id;
              const twoId = isTeam ? match.team_two_id : match.pair_two_id;
              return (
                match.winner_side != null &&
                ((oneId === a.id && twoId === b.id) || (oneId === b.id && twoId === a.id))
              );
            });
            if (direct?.winner_side) {
              const oneId = isTeam ? direct.team_one_id : direct.pair_one_id;
              const aWon = oneId === a.id ? direct.winner_side === 1 : direct.winner_side === 2;
              return aWon ? -1 : 1;
            }
            continue;
          }
          const value = (row: typeof a) =>
            key === 'points'
              ? row.points
              : key === 'matches_won'
                ? row.wins
                : key === 'sets_won'
                  ? row.setsWon
                  : key === 'games_won'
                    ? row.gamesWon
                    : key === 'set_difference'
                      ? row.setsWon - row.setsLost
                      : key === 'game_difference'
                        ? row.gamesWon - row.gamesLost
                        : 0;
          const difference = value(b) - value(a);
          if (difference) return difference;
        }
        return a.name.localeCompare(b.name);
      });
      const manualRanks = persistedOverrides
        .filter((item) => item.group_number === groupNumber && item.override_type === 'ranking')
        .sort((a, b) => a.override_value - b.override_value);
      for (const override of manualRanks) {
        const currentIndex = stats.findIndex((row) => row.id === override.entry_id);
        if (currentIndex < 0) continue;
        const [row] = stats.splice(currentIndex, 1);
        stats.splice(Math.max(0, Math.min(stats.length, override.override_value - 1)), 0, row);
      }
      rankedByGroup.set(
        groupNumber,
        stats.map(({ id, name }) => ({ id, name })),
      );
    }
    const { data: bracketRows, error: bracketError } = await db
      .from('tournament_matches')
      .select('*')
      .eq('event_id', eventId)
      .eq('category', category)
      .in('phase', isTeam ? [knockoutPhase] : ['preliminary_knockout', knockoutPhase])
      .eq('round_number', 1);
    if (bracketError) throw new Error(bracketError.message);
    let promotedSlotsUpdated = false;
    for (const match of (bracketRows ?? []) as Match[]) {
      let notes: { slot_one?: string | null; slot_two?: string | null } = {};
      try {
        notes = JSON.parse(match.notes || '{}') as typeof notes;
      } catch {
        continue;
      }
      const changes: Record<string, unknown> = {};
      for (const side of [1, 2] as const) {
        const label = side === 1 ? notes.slot_one : notes.slot_two;
        const parsed = label?.match(/^Group (\d+) Team (\d+)$/);
        if (!parsed) continue;
        const promoted = rankedByGroup.get(Number(parsed[1]))?.[Number(parsed[2]) - 1];
        if (!promoted) continue;
        changes[
          isTeam
            ? side === 1
              ? 'team_one_id'
              : 'team_two_id'
            : side === 1
              ? 'pair_one_id'
              : 'pair_two_id'
        ] = promoted.id;
        if (side === 1) notes.slot_one = null;
        else notes.slot_two = null;
      }
      if (Object.keys(changes).length) {
        changes.notes = JSON.stringify(notes);
        changes.updated_at = new Date().toISOString();
        const { error: updateError } = await db
          .from('tournament_matches')
          .update(changes)
          .eq('id', match.id);
        if (updateError) throw new Error(updateError.message);
        promotedSlotsUpdated = true;
      }
    }
    if (promotedSlotsUpdated) await refresh();
  }

  async function randomizeKnockoutDraw() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (
        matches.some(
          (match) =>
            match.category === matchCategory &&
            match.phase.includes('knockout') &&
            (match.status === 'completed' ||
              match.winner_side != null ||
              (match.score_sets?.length ?? 0) > 0),
        )
      ) {
        throw new Error(
          'The knockout bracket cannot be regenerated because match results exist. Edit the bracket manually instead.',
        );
      }
      const phase = matchPhase;
      const category = isTeam ? 'team' : activeCategory;
      const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
      const roundRobinEnabled =
        phase === (isTeam ? 'team_knockout' : 'final_knockout') &&
        (isTeam ? enabledPhases.team_round_robin !== false : enabledPhases.round_robin !== false);
      type Slot = { id: string | null; label: string; group: number | null; rank: number | null };
      let slots: Slot[] = [];
      const shuffled = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
      const allSides: Array<Team | Pair> = isTeam
        ? teams
        : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory);
      if (roundRobinEnabled) {
        if (allSides.some((side) => !side.group_number))
          throw new Error(
            'Assign every team or pair to a group before generating the knockout draw.',
          );
        const promote = Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
        const configuredGroupCount = Math.max(2, Number(config?.group_count ?? 2));
        const groups = allSides.length
          ? [
              ...new Set(allSides.map((side) => side.group_number).filter((n): n is number => !!n)),
            ].sort((a, b) => a - b)
          : Array.from({ length: configuredGroupCount }, (_, index) => index + 1);
        const groupRanked = groups.map((groupNumber) => {
          const groupSides = allSides.filter((side) => side.group_number === groupNumber);
          const relevantMatches = matches.filter(
            (m) =>
              m.category === category &&
              m.phase === roundRobinPhase &&
              m.group_number === groupNumber &&
              m.status !== 'cancelled',
          );
          const expected = (groupSides.length * (groupSides.length - 1)) / 2;
          const complete =
            expected > 0 &&
            relevantMatches.filter((m) => m.status === 'completed' || m.winner_side != null)
              .length >= expected;
          const stats = groupSides
            .map((side) => {
              const row = {
                side,
                wins: 0,
                points: 0,
                setsWon: 0,
                gamesWon: 0,
                setDiff: 0,
                gameDiff: 0,
              };
              for (const match of relevantMatches) {
                const firstId = isTeam ? match.team_one_id : match.pair_one_id;
                const secondId = isTeam ? match.team_two_id : match.pair_two_id;
                if (firstId !== side.id && secondId !== side.id) continue;
                if (
                  match.winner_side &&
                  ((firstId === side.id && match.winner_side === 1) ||
                    (secondId === side.id && match.winner_side === 2))
                )
                  row.wins++;
                if (isTeam)
                  row.points +=
                    firstId === side.id
                      ? Number(match.team_points_one ?? 0)
                      : Number(match.team_points_two ?? 0);
                for (const set of match.score_sets ?? []) {
                  const oneSide = firstId === side.id;
                  const own = oneSide ? set.one : set.two;
                  const against = oneSide ? set.two : set.one;
                  row.setsWon += own > against ? 1 : 0;
                  row.setDiff += (own > against ? 1 : 0) - (own < against ? 1 : 0);
                  row.gamesWon += own;
                  row.gameDiff += own - against;
                }
              }
              return row;
            })
            .sort((a, b) => {
              const priority =
                config?.ranking_priority ??
                (isTeam
                  ? [
                      'points',
                      'matches_won',
                      'sets_won',
                      'games_won',
                      'set_difference',
                      'game_difference',
                      'head_to_head',
                    ]
                  : [
                      'matches_won',
                      'sets_won',
                      'games_won',
                      'set_difference',
                      'game_difference',
                      'head_to_head',
                    ]);
              const metric = (row: typeof a, key: string) =>
                key === 'points'
                  ? row.points
                  : key === 'matches_won'
                    ? row.wins
                    : key === 'sets_won'
                      ? row.setsWon
                      : key === 'games_won'
                        ? row.gamesWon
                        : key === 'set_difference'
                          ? row.setDiff
                          : key === 'game_difference'
                            ? row.gameDiff
                            : 0;
              for (const key of priority) {
                if (key === 'head_to_head') {
                  const direct = relevantMatches.find((match) => {
                    const firstId = isTeam ? match.team_one_id : match.pair_one_id;
                    const secondId = isTeam ? match.team_two_id : match.pair_two_id;
                    return (
                      match.winner_side != null &&
                      ((firstId === a.side.id && secondId === b.side.id) ||
                        (firstId === b.side.id && secondId === a.side.id))
                    );
                  });
                  if (direct?.winner_side) {
                    const firstId = isTeam ? direct.team_one_id : direct.pair_one_id;
                    const aWon =
                      firstId === a.side.id ? direct.winner_side === 1 : direct.winner_side === 2;
                    return aWon ? -1 : 1;
                  }
                  continue;
                }
                const difference = metric(b, key) - metric(a, key);
                if (difference) return difference;
              }
              const aName = 'name' in a.side ? a.side.name : a.side.player_one_name || '';
              const bName = 'name' in b.side ? b.side.name : b.side.player_one_name || '';
              return aName.localeCompare(bName);
            });
          return { groupNumber, stats, complete };
        });
        for (let rank = 1; rank <= promote; rank++) {
          for (const group of groupRanked) {
            const entry = group.stats[rank - 1];
            slots.push({
              id: group.complete && entry ? entry.side.id : null,
              label: entry
                ? `Group ${group.groupNumber} Team ${rank}`
                : `Group ${group.groupNumber} Team ${rank}`,
              group: group.groupNumber,
              rank,
            });
          }
        }
      } else {
        slots = shuffled(allSides).map((side) => ({
          id: side.id,
          label: 'TBD',
          group: side.group_number,
          rank: null,
        }));
        if (slots.length === 0) {
          const placeholderGroupCount = Math.max(2, Number(config?.group_count ?? 2));
          const placeholderPromotions = Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
          slots = Array.from(
            { length: placeholderGroupCount * placeholderPromotions },
            (_, index) => ({
              id: null,
              label: `Group ${Math.floor(index / placeholderPromotions) + 1} Team ${(index % placeholderPromotions) + 1}`,
              group: Math.floor(index / placeholderPromotions) + 1,
              rank: (index % placeholderPromotions) + 1,
            }),
          );
        }
      }
      if (slots.length < 2)
        throw new Error('At least two eligible teams or pairs are required for a knockout draw.');
      const bracketSize = 2 ** Math.ceil(Math.log2(slots.length));
      while (slots.length < bracketSize)
        slots.push({ id: null, label: 'Bye', group: null, rank: null });
      slots = pairKnockoutFirstRound({
        slots,
        roundRobinEnabled,
        promotedPerGroup: Math.max(1, Number(config?.promoted_teams_per_group ?? 2)),
      }).flat();
      const existingDraw = matches.filter(
        (match) => match.category === category && match.phase === phase,
      );
      if (
        existingDraw.some(
          (match) =>
            match.status === 'completed' ||
            (match.score_sets?.length ?? 0) > 0 ||
            match.winner_side != null,
        )
      ) {
        throw new Error(
          'This knockout stage already has results. Existing match history will not be replaced.',
        );
      }
      const eventEnd = new Date(eventEndsAt || eventStartsAt);
      const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60));
      const breakMinutes = Math.max(10, Number(config?.schedule?.break_minutes ?? 15));
      const prerequisitePhases =
        phase === (isTeam ? 'team_knockout' : 'final_knockout')
          ? isTeam
            ? ['team_round_robin']
            : ['preliminary_knockout', 'round_robin']
          : [];
      let phaseStart = new Date(eventStartsAt);
      if (prerequisitePhases.length) {
        const { data: prerequisiteRows, error: prerequisiteError } = await db
          .from('tournament_matches')
          .select('scheduled_at,status,phase')
          .eq('event_id', eventId)
          .eq('category', category)
          .in('phase', prerequisitePhases)
          .neq('status', 'cancelled');
        if (prerequisiteError) throw new Error(prerequisiteError.message);
        phaseStart = phaseStartAfterPrerequisites({
          baseStart: eventStartsAt,
          prerequisiteMatches: (prerequisiteRows ?? []).map((match) => ({
            scheduled_at: match.scheduled_at as string | null,
            status: String(match.status),
          })),
          matchMinutes: duration,
          minimumBreakMinutes: 60,
        });
      }
      if (existingDraw.length) {
        const existingIds = existingDraw.map((match) => match.id);
        const { error: playersDeleteError } = await db
          .from('tournament_match_players')
          .delete()
          .in('match_id', existingIds);
        if (playersDeleteError) throw new Error(playersDeleteError.message);
        const { error: matchesDeleteError } = await db
          .from('tournament_matches')
          .delete()
          .in('id', existingIds);
        if (matchesDeleteError) throw new Error(matchesDeleteError.message);
      }
      const rows: Record<string, unknown>[] = [];
      const rounds = Math.log2(bracketSize);
      let count = bracketSize / 2;
      for (let round = 1; round <= rounds; round++) {
        for (let matchNumber = 1; matchNumber <= count; matchNumber++) {
          const first = round === 1 ? slots[(matchNumber - 1) * 2] : null;
          const second = round === 1 ? slots[(matchNumber - 1) * 2 + 1] : null;
          const notes =
            round === 1
              ? JSON.stringify({
                  slot_one: first?.id ? null : (first?.label ?? 'TBD'),
                  slot_two: second?.id ? null : (second?.label ?? 'TBD'),
                })
              : JSON.stringify({
                  slot_one: `Winner of ${round === 2 ? 'Round 1' : `Round ${round - 1}`} ${matchNumber * 2 - 1}`,
                  slot_two: `Winner of ${round === 2 ? 'Round 1' : `Round ${round - 1}`} ${matchNumber * 2}`,
                });
          // A generated BYE must be recognized even when the opposing side is
          // an unresolved group-place slot (e.g. "Group 3 Team 2") with no ID yet.
          // winner_side points to the side that advances; matchSideValue uses it
          // to preselect BYE in the opposite dropdown.
          const firstIsDefinedEntrant =
            Boolean(first?.id) ||
            Boolean(first?.label && first.label !== 'Bye' && first.label !== 'TBD');
          const secondIsDefinedEntrant =
            Boolean(second?.id) ||
            Boolean(second?.label && second.label !== 'Bye' && second.label !== 'TBD');
          const byeWinner =
            round === 1
              ? first?.label === 'Bye' && secondIsDefinedEntrant
                ? 2
                : second?.label === 'Bye' && firstIsDefinedEntrant
                  ? 1
                  : null
              : null;
          rows.push({
            event_id: eventId,
            category,
            phase,
            round_number: round,
            match_number: matchNumber,
            status: byeWinner ? 'bye' : 'scheduled',
            winner_side: byeWinner,
            notes,
            ...(isTeam
              ? { team_one_id: first?.id ?? null, team_two_id: second?.id ?? null }
              : { pair_one_id: first?.id ?? null, pair_two_id: second?.id ?? null }),
          });
        }
        count = Math.ceil(count / 2);
      }
      const { data: createdMatches, error: insertError } = await db
        .from('tournament_matches')
        .insert(rows)
        .select('*');
      if (insertError) throw new Error(insertError.message);
      // A bye advances automatically without occupying a court or counting as a played match.
      for (const bye of (createdMatches ?? []).filter(
        (match: Match) =>
          match.status === 'bye' && match.winner_side && match.round_number < rounds,
      )) {
        const next = (createdMatches ?? []).find(
          (match: Match) =>
            match.round_number === bye.round_number + 1 &&
            match.match_number === Math.ceil(bye.match_number / 2),
        ) as Match | undefined;
        const winnerId = isTeam
          ? bye.winner_side === 1
            ? bye.team_one_id
            : bye.team_two_id
          : bye.winner_side === 1
            ? bye.pair_one_id
            : bye.pair_two_id;
        if (next && winnerId) {
          const targetSide = bye.match_number % 2 === 1 ? 1 : 2;
          const field = isTeam
            ? targetSide === 1
              ? 'team_one_id'
              : 'team_two_id'
            : targetSide === 1
              ? 'pair_one_id'
              : 'pair_two_id';
          const { error: byeAdvanceError } = await db
            .from('tournament_matches')
            .update({ [field]: winnerId })
            .eq('id', next.id);
          if (byeAdvanceError) throw new Error(byeAdvanceError.message);
          (next as unknown as Record<string, unknown>)[field] = winnerId;
          if (!isTeam) {
            const winnerPair = pairs.find((pair) => pair.id === winnerId);
            if (winnerPair) {
              const { error: playerAssignmentError } = await db
                .from('tournament_match_players')
                .insert([
                  {
                    match_id: next.id,
                    participant_id: winnerPair.player_one_id,
                    side: targetSide,
                    team_id: null,
                  },
                  {
                    match_id: next.id,
                    participant_id: winnerPair.player_two_id,
                    side: targetSide,
                    team_id: null,
                  },
                ]);
              if (playerAssignmentError) throw new Error(playerAssignmentError.message);
            }
          }
        }
      }
      const knockoutAssignments = buildKnockoutSchedule({
        matches: ((createdMatches ?? []) as Match[]).map((match) => ({
          id: match.id,
          round_number: match.round_number,
          match_number: match.match_number,
          status: match.status,
        })),
        baseStart: phaseStart,
        eventEnd,
        matchMinutes: duration,
        betweenMatchBreakMinutes: breakMinutes,
        courtCount,
        stageBreakMinutes: 60,
      });
      for (const assignment of knockoutAssignments) {
        const { error: scheduleError } = await db
          .from('tournament_matches')
          .update({ scheduled_at: assignment.scheduled_at, court_number: assignment.court_number })
          .eq('id', assignment.id);
        if (scheduleError) throw new Error(scheduleError.message);
        const created = ((createdMatches ?? []) as Match[]).find(
          (match) => match.id === assignment.id,
        );
        if (created) {
          created.scheduled_at = assignment.scheduled_at;
          created.court_number = assignment.court_number;
        }
      }
      // Assign participant history for all first-round matches with known pairs.
      if (!isTeam) {
        const assignments = (createdMatches ?? [])
          .filter((m: Match) => m.round_number === 1 && m.pair_one_id && m.pair_two_id)
          .flatMap((match: Match) => {
            const one = pairs.find((pair) => pair.id === match.pair_one_id);
            const two = pairs.find((pair) => pair.id === match.pair_two_id);
            return one && two
              ? [
                  { match_id: match.id, participant_id: one.player_one_id, side: 1, team_id: null },
                  { match_id: match.id, participant_id: one.player_two_id, side: 1, team_id: null },
                  { match_id: match.id, participant_id: two.player_one_id, side: 2, team_id: null },
                  { match_id: match.id, participant_id: two.player_two_id, side: 2, team_id: null },
                ]
              : [];
          });
        if (assignments.length) {
          const { error: playerError } = await db
            .from('tournament_match_players')
            .insert(assignments);
          if (playerError) throw new Error(playerError.message);
        }
      }
      setMessage(
        `Created a ${rounds}-round knockout bracket and suggested a schedule. Review the draw and edit any match as needed.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate knockout draw.');
    } finally {
      setBusy(false);
    }
  }
  async function advanceKnockoutWinner(match: Match, winnerSide: 1 | 2) {
    if (!match.phase.includes('knockout')) return;
    const nextMatch = matches.find(
      (item) =>
        item.category === match.category &&
        item.phase === match.phase &&
        item.round_number === match.round_number + 1 &&
        item.match_number === Math.ceil(match.match_number / 2),
    );
    if (!nextMatch) return;
    const targetSide = match.match_number % 2 === 1 ? 1 : 2;
    const winnerId = isTeam
      ? winnerSide === 1
        ? match.team_one_id
        : match.team_two_id
      : winnerSide === 1
        ? match.pair_one_id
        : match.pair_two_id;
    if (!winnerId) return;
    const field = isTeam
      ? targetSide === 1
        ? 'team_one_id'
        : 'team_two_id'
      : targetSide === 1
        ? 'pair_one_id'
        : 'pair_two_id';
    const { error: advanceError } = await db
      .from('tournament_matches')
      .update({ [field]: winnerId, updated_at: new Date().toISOString() })
      .eq('id', nextMatch.id);
    if (advanceError) {
      setError(`Result saved, but the winner could not be advanced: ${advanceError.message}`);
      return;
    }
    if (!isTeam) {
      const winnerPair = pairs.find((pair) => pair.id === winnerId);
      if (winnerPair) {
        const { error: deleteError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('match_id', nextMatch.id)
          .eq('side', targetSide);
        if (deleteError) {
          setError(
            `Winner advanced, but participant history could not be updated: ${deleteError.message}`,
          );
          return;
        }
        const { error: playerError } = await db.from('tournament_match_players').insert([
          {
            match_id: nextMatch.id,
            participant_id: winnerPair.player_one_id,
            side: targetSide,
            team_id: null,
          },
          {
            match_id: nextMatch.id,
            participant_id: winnerPair.player_two_id,
            side: targetSide,
            team_id: null,
          },
        ]);
        if (playerError) {
          setError(
            `Winner advanced, but participant history could not be updated: ${playerError.message}`,
          );
          return;
        }
      }
    }
    await refresh();
  }

  async function recordWalkover(match: Match, winnerSide: 1 | 2) {
    const bonusScoring =
      (config?.scoring_templates?.[
        match.phase as keyof NonNullable<TournamentConfig['scoring_templates']>
      ] ?? config?.scoring_template) === 'team_two_sets_bonus_third';
    const saved = await runAction(
      () =>
        db
          .from('tournament_matches')
          .update({
            winner_side: winnerSide,
            score_sets: match.phase.includes('round_robin')
              ? [
                  winnerSide === 1 ? { one: 6, two: 0 } : { one: 0, two: 6 },
                  winnerSide === 1 ? { one: 6, two: 0 } : { one: 0, two: 6 },
                ]
              : [],
            status: 'completed',
            notes:
              winnerSide === 1
                ? 'Walkover / retirement awarded to side one'
                : 'Walkover / retirement awarded to side two',
            team_points_one: isTeam ? (winnerSide === 1 ? (bonusScoring ? 3 : 1) : 0) : 0,
            team_points_two: isTeam ? (winnerSide === 2 ? (bonusScoring ? 3 : 1) : 0) : 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', match.id),
      'Walkover recorded.',
    );
    if (saved) {
      if (match.phase.includes('round_robin')) {
        try {
          await syncPromotedKnockoutEntrants();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Could not update promoted teams.');
        }
      }
      await advanceKnockoutWinner(match, winnerSide);
    }
  }

  async function deleteMatch(match: Match) {
    setPendingDeleteMatch(match);
  }
  async function confirmDeleteMatch() {
    if (!pendingDeleteMatch) return;
    const match = pendingDeleteMatch;
    setPendingDeleteMatch(null);
    await runAction(
      () => db.from('tournament_matches').delete().eq('id', match.id),
      'Match deleted.',
    );
  }
  async function saveScore(match: Match, raw: string, confirmWalkoverReplacement = false) {
    if (
      isTeam &&
      ([1, 2] as const).some(
        (side) =>
          matchPlayers.filter(
            (player) =>
              player.match_id === match.id &&
              player.side === side &&
              player.team_id === (side === 1 ? match.team_one_id : match.team_two_id),
          ).length !== 2,
      )
    ) {
      setError(
        'Assign two players to each team before recording the result so individual records remain accurate.',
      );
      return;
    }
    const sets = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const parts = s.split('-').map(Number);
        return { one: parts[0], two: parts[1] };
      });
    if (
      !sets.length ||
      sets.some(
        (s) =>
          !Number.isInteger(s.one) ||
          !Number.isInteger(s.two) ||
          s.one < 0 ||
          s.two < 0 ||
          s.one === s.two,
      )
    ) {
      setError('Enter decisive set scores like 6-4, 3-6, 10-8.');
      return;
    }
    const scoringTemplate =
      config?.scoring_templates?.[
        match.phase as keyof NonNullable<TournamentConfig['scoring_templates']>
      ] ?? config?.scoring_template;
    if (scoringTemplate === 'one_set' && sets.length !== 1) {
      setError('This scoring template requires exactly one set.');
      return;
    }
    if (
      scoringTemplate === 'best_of_three' &&
      (sets.length > 3 ||
        Math.max(
          sets.filter((s) => s.one > s.two).length,
          sets.filter((s) => s.two > s.one).length,
        ) < 2)
    ) {
      setError('Best-of-three requires a player to win two sets, with no more than three sets.');
      return;
    }
    if (
      scoringTemplate === 'two_sets_then_third' &&
      (sets.length < 2 ||
        sets.length > 3 ||
        (sets[0].one > sets[0].two === sets[1].one > sets[1].two && sets.length !== 2) ||
        (sets[0].one > sets[0].two !== sets[1].one > sets[1].two && sets.length !== 3))
    ) {
      setError('Play two sets; add a deciding third set only when the first two are split.');
      return;
    }
    if (
      scoringTemplate === 'team_two_sets_bonus_third' &&
      (sets.length < 2 ||
        sets.length > 3 ||
        (sets[0].one > sets[0].two === sets[1].one > sets[1].two && sets.length !== 2) ||
        (sets[0].one > sets[0].two !== sets[1].one > sets[1].two && sets.length !== 3))
    ) {
      setError(
        'This team scoring template requires two sets, plus a third set if the first two are split.',
      );
      return;
    }
    const winsOne = sets.filter((s) => s.one > s.two).length;
    const winsTwo = sets.filter((s) => s.two > s.one).length;
    if (winsOne === winsTwo) {
      setError('The set scores must identify a winner.');
      return;
    }
    const winner = winsOne > winsTwo ? 1 : 2;
    let pointsOne = winner === 1 ? 1 : 0;
    let pointsTwo = winner === 2 ? 1 : 0;
    const scoring =
      config?.scoring_templates?.[
        match.phase as keyof NonNullable<TournamentConfig['scoring_templates']>
      ] ?? config?.scoring_template;
    if (scoring === 'team_two_sets_bonus_third') {
      const firstTwo = sets.slice(0, 2);
      const a = firstTwo.filter((s) => s.one > s.two).length;
      const b = firstTwo.filter((s) => s.two > s.one).length;
      if (a === 2) {
        pointsOne = 3;
        pointsTwo = 0;
      } else if (b === 2) {
        pointsOne = 0;
        pointsTwo = 3;
      } else {
        pointsOne = winner === 1 ? 2 : 1;
        pointsTwo = winner === 2 ? 2 : 1;
      }
    }
    const isWalkoverResult = /^Walkover \/ retirement awarded to side (one|two)$/i.test(
      match.notes?.trim() ?? '',
    );
    if (isWalkoverResult && !confirmWalkoverReplacement) {
      setPendingWalkoverScore({ match, raw });
      return;
    }
    const scoreSaved = await saveMatch(match, {
      score_sets: sets,
      winner_side: winner,
      status: 'completed',
      team_points_one: pointsOne,
      team_points_two: pointsTwo,
      ...(isWalkoverResult ? { notes: '' } : {}),
    });
    if (!scoreSaved) return;
    setMessage('Match score saved.');
    if (match.phase.includes('round_robin')) {
      try {
        await syncPromotedKnockoutEntrants();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update promoted teams.');
      }
    }
    await advanceKnockoutWinner(match, winner);
  }

  const isTeam = format === 'team';
  const enabledPhases = config?.phases ?? {
    round_robin: true,
    preliminary_knockout: false,
    final_knockout: true,
  };
  const teamSizes = teams.map(
    (team) =>
      participants.filter(
        (participant) =>
          participant.team_id === team.id &&
          participant.category === 'team' &&
          participant.status === 'registered',
      ).length,
  );
  const unevenTeams =
    isTeam && teamSizes.length > 1 && Math.max(...teamSizes) - Math.min(...teamSizes) > 1;
  const availableMatchPhases = (
    isTeam
      ? phases.filter(
          ([key]) =>
            key.startsWith('team_') &&
            (key === 'team_round_robin'
              ? enabledPhases.team_round_robin !== false
              : enabledPhases.team_knockout !== false),
        )
      : phases.filter(
          ([key]) =>
            !key.startsWith('team_') &&
            (key !== 'preliminary_knockout' || enabledPhases.preliminary_knockout) &&
            (key !== 'round_robin' || enabledPhases.round_robin) &&
            (key !== 'final_knockout' || enabledPhases.final_knockout),
        )
  ) as ReadonlyArray<readonly [string, string]>;
  const availablePhaseKey = availableMatchPhases.map(([key]) => key).join(',');
  useEffect(() => {
    if (availableMatchPhases.length && !availableMatchPhases.some(([key]) => key === matchPhase))
      setMatchPhase(availableMatchPhases[0][0]);
  }, [availablePhaseKey, matchPhase]);
  const currentBracketEntrantCount = isTeam
    ? teams.length
    : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory)
        .length;
  const bracketUsesRoundRobinPromotion =
    matchPhase === (isTeam ? 'team_knockout' : 'final_knockout') &&
    (isTeam ? enabledPhases.team_round_robin !== false : enabledPhases.round_robin !== false);
  const bracketGroupCount = Math.max(2, Number(config?.group_count ?? 2));
  const assignedGroupCount = new Set(
    (isTeam
      ? teams
      : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory)
    )
      .map((entry) => entry.group_number)
      .filter((group): group is number => group != null),
  ).size;
  const expectedBracketEntrantCount = bracketUsesRoundRobinPromotion
    ? (assignedGroupCount || bracketGroupCount) *
      Math.max(1, Number(config?.promoted_teams_per_group ?? 2))
    : currentBracketEntrantCount || bracketGroupCount;
  const existingKnockoutMatches = matches.filter(
    (match) =>
      match.category === (isTeam ? 'team' : activeCategory) &&
      match.phase === matchPhase &&
      match.phase.includes('knockout'),
  );
  const existingBracketEntrants = new Set(
    existingKnockoutMatches
      .filter((match) => match.round_number === 1)
      .flatMap((match) => {
        const ids = isTeam
          ? [match.team_one_id, match.team_two_id]
          : [match.pair_one_id, match.pair_two_id];
        let slots: Array<string | null> = [];
        try {
          const notes = JSON.parse(match.notes || '{}') as {
            slot_one?: string | null;
            slot_two?: string | null;
          };
          slots = [notes.slot_one ?? null, notes.slot_two ?? null];
        } catch {}
        return ids.map(
          (id, index) =>
            id || (slots[index] && slots[index] !== 'Bye' ? `slot:${slots[index]}` : null),
        );
      })
      .filter((id): id is string => Boolean(id)),
  );
  const bracketNeedsRedraw =
    existingKnockoutMatches.length > 0 &&
    existingBracketEntrants.size !== expectedBracketEntrantCount;
  const knockoutBracketHasResults = existingKnockoutMatches.some(
    (match) =>
      match.status === 'completed' ||
      match.winner_side != null ||
      (match.score_sets?.length ?? 0) > 0,
  );
  const isRoundRobinPhase = matchPhase.includes('round_robin');
  const adminRoundByMatch = useMemo(() => {
    const counts = new Map<string, number>();
    const result = new Map<string, number>();
    const ordered = matches
      .filter(
        (match) =>
          match.category === matchCategory &&
          match.phase === matchPhase &&
          match.status !== 'cancelled',
      )
      .sort((a, b) => {
        const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
        return (
          aTime - bTime ||
          (a.court_number ?? Number.MAX_SAFE_INTEGER) - (b.court_number ?? Number.MAX_SAFE_INTEGER)
        );
      });
    for (const match of ordered) {
      const first = isTeam ? match.team_one_id : match.pair_one_id;
      const second = isTeam ? match.team_two_id : match.pair_two_id;
      const firstRound = first ? (counts.get(first) ?? 0) + 1 : match.round_number;
      const secondRound = second ? (counts.get(second) ?? 0) + 1 : match.round_number;
      if (first) counts.set(first, firstRound);
      if (second) counts.set(second, secondRound);
      result.set(match.id, Math.min(firstRound, secondRound));
    }
    return result;
  }, [matches, matchCategory, matchPhase, isTeam]);
  const adminMatchList = useMemo(() => {
    const list = matches.filter(
      (match) =>
        match.category === (isTeam ? 'team' : activeCategory) && match.phase === matchPhase,
    );
    return list.sort((a, b) => {
      if (matchPhase.includes('knockout')) {
        const stageDifference = a.round_number - b.round_number;
        if (stageDifference) return stageDifference;
      }
      if (isRoundRobinPhase) {
        const groupA = a.group_number ?? Number.MAX_SAFE_INTEGER;
        const groupB = b.group_number ?? Number.MAX_SAFE_INTEGER;
        const roundA = adminRoundByMatch.get(a.id) ?? a.round_number;
        const roundB = adminRoundByMatch.get(b.id) ?? b.round_number;
        const groupOrRound = matchGrouping === 'group' ? groupA - groupB : roundA - roundB;
        if (groupOrRound) return groupOrRound;
      }
      const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      return (
        timeA - timeB ||
        (a.court_number ?? Number.MAX_SAFE_INTEGER) - (b.court_number ?? Number.MAX_SAFE_INTEGER)
      );
    });
  }, [
    matches,
    isTeam,
    activeCategory,
    matchPhase,
    isRoundRobinPhase,
    adminRoundByMatch,
    matchGrouping,
  ]);
  const courtScheduleConflicts = useMemo(() => {
    const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000;
    const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15)) * 60000;
    const conflicts: Array<{
      court: number;
      previous: Match;
      current: Match;
      severity: 'danger' | 'warning';
    }> = [];
    for (let court = 1; court <= Math.max(1, courtCount); court++) {
      const scheduled = matches
        .filter(
          (match) =>
            match.court_number === court && match.status !== 'cancelled' && !!match.scheduled_at,
        )
        .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
      for (let index = 1; index < scheduled.length; index++) {
        const previous = scheduled[index - 1];
        const current = scheduled[index];
        const previousEnd = new Date(previous.scheduled_at!).getTime() + duration;
        const currentStart = new Date(current.scheduled_at!).getTime();
        if (currentStart < previousEnd) {
          conflicts.push({ court, previous, current, severity: 'danger' });
        } else if (currentStart < previousEnd + gap) {
          conflicts.push({ court, previous, current, severity: 'warning' });
        }
      }
    }
    return conflicts;
  }, [matches, config?.schedule?.match_minutes, config?.schedule?.break_minutes, courtCount]);

  function matchCourtTileNames(match: Match) {
    const firstId = isTeam ? match.team_one_id : match.pair_one_id;
    const secondId = isTeam ? match.team_two_id : match.pair_two_id;
    const nameFor = (id: string | null) => {
      if (!id) return 'TBD';
      if (isTeam) return teams.find((team) => team.id === id)?.name ?? 'TBD';
      const pair = pairs.find((pair) => pair.id === id);
      return pair
        ? `${pair.player_one_name || 'Player'} + ${pair.player_two_name || 'Player'}`
        : 'TBD';
    };
    const stage =
      match.phase.includes('knockout') || match.phase === 'team_knockout'
        ? `${knockoutStageLabel(match.round_number, Math.max(1, ...matches.filter((item) => item.phase === match.phase).map((item) => item.round_number)))} ${match.match_number}`
        : match.group_number
          ? `Group ${match.group_number}`
          : 'Round robin';
    return { players: `${nameFor(firstId)} vs ${nameFor(secondId)}`, stage };
  }

  async function moveMatchToCourt(match: Match, court: number | null) {
    if (match.court_number === court) return;
    const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000;
    const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15)) * 60000;
    const conflicts: Array<{ match: Match; severity: 'danger' | 'warning' }> = [];
    if (court != null && match.scheduled_at) {
      const start = new Date(match.scheduled_at).getTime();
      const end = start + duration;
      for (const other of matches) {
        if (
          other.id === match.id ||
          other.status === 'cancelled' ||
          !other.scheduled_at ||
          other.court_number !== court
        )
          continue;
        const otherStart = new Date(other.scheduled_at).getTime();
        const otherEnd = otherStart + duration;
        const overlaps = start < otherEnd && otherStart < end;
        const tooCloseAfter = start >= otherEnd && start < otherEnd + gap;
        const tooCloseBefore = otherStart >= end && otherStart < end + gap;
        if (overlaps) conflicts.push({ match: other, severity: 'danger' });
        else if (tooCloseAfter || tooCloseBefore)
          conflicts.push({ match: other, severity: 'warning' });
      }
    }
    if (conflicts.length) {
      setPendingCourtMove({ match, court, conflicts });
      return;
    }
    await runAction(
      () =>
        db
          .from('tournament_matches')
          .update({ court_number: court, updated_at: new Date().toISOString() })
          .eq('id', match.id),
      'Court assignment updated.',
    );
  }

  async function confirmCourtMove() {
    if (!pendingCourtMove) return;
    const { match, court } = pendingCourtMove;
    setPendingCourtMove(null);
    await runAction(
      () =>
        db
          .from('tournament_matches')
          .update({ court_number: court, updated_at: new Date().toISOString() })
          .eq('id', match.id),
      'Court assignment updated. Scheduling conflicts remain and are highlighted below.',
    );
  }

  const visibleAuditRows = auditRows.filter((row) => {
    const category = String(row.after_data?.category ?? row.before_data?.category ?? '');
    if (isTeam) return !category || category === 'team';
    if (category) return category === activeCategory;
    if (row.entity_type.includes('participant'))
      return participants.find((p) => p.id === row.entity_id)?.category === activeCategory;
    if (row.entity_type.includes('pair'))
      return pairs.find((pair) => pair.id === row.entity_id)?.category === activeCategory;
    if (row.entity_type.includes('match'))
      return matches.find((match) => match.id === row.entity_id)?.category === activeCategory;
    return true;
  });
  function groupPlaceDescription(entry: Team | Pair): string {
    const groupNumber = entry.group_number;
    if (!groupNumber) return 'No group assigned';
    const category = isTeam ? 'team' : activeCategory;
    const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
    const groupEntries = (
      isTeam
        ? teams
        : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory)
    ).filter((item) => item.group_number === groupNumber);
    const groupMatches = matches.filter(
      (match) =>
        match.category === category &&
        match.phase === roundRobinPhase &&
        match.group_number === groupNumber &&
        match.status !== 'cancelled',
    );
    const playedMatches = groupMatches.filter(
      (match) => match.status === 'completed' || match.winner_side != null,
    );
    if (!playedMatches.length) return `Group ${groupNumber}`;

    const stats = groupEntries.map((side) => {
      const row = { side, wins: 0, points: 0, setsWon: 0, gamesWon: 0, setDiff: 0, gameDiff: 0 };
      for (const match of playedMatches) {
        const firstId = isTeam ? match.team_one_id : match.pair_one_id;
        const secondId = isTeam ? match.team_two_id : match.pair_two_id;
        if (firstId !== side.id && secondId !== side.id) continue;
        if (
          match.winner_side &&
          ((firstId === side.id && match.winner_side === 1) ||
            (secondId === side.id && match.winner_side === 2))
        )
          row.wins += 1;
        if (isTeam)
          row.points +=
            firstId === side.id
              ? Number(match.team_points_one ?? 0)
              : Number(match.team_points_two ?? 0);
        for (const set of match.score_sets ?? []) {
          const own = firstId === side.id ? set.one : set.two;
          const against = firstId === side.id ? set.two : set.one;
          row.setsWon += own > against ? 1 : 0;
          row.setDiff += (own > against ? 1 : 0) - (own < against ? 1 : 0);
          row.gamesWon += own;
          row.gameDiff += own - against;
        }
      }
      return row;
    });
    const priority =
      config?.ranking_priority ??
      (isTeam
        ? [
            'points',
            'matches_won',
            'sets_won',
            'games_won',
            'set_difference',
            'game_difference',
            'head_to_head',
          ]
        : [
            'matches_won',
            'sets_won',
            'games_won',
            'set_difference',
            'game_difference',
            'head_to_head',
          ]);
    const metric = (row: (typeof stats)[number], key: string) =>
      key === 'points'
        ? row.points
        : key === 'matches_won'
          ? row.wins
          : key === 'sets_won'
            ? row.setsWon
            : key === 'games_won'
              ? row.gamesWon
              : key === 'set_difference'
                ? row.setDiff
                : key === 'game_difference'
                  ? row.gameDiff
                  : 0;
    stats.sort((a, b) => {
      for (const key of priority) {
        if (key === 'head_to_head') {
          const direct = playedMatches.find((match) => {
            const firstId = isTeam ? match.team_one_id : match.pair_one_id;
            const secondId = isTeam ? match.team_two_id : match.pair_two_id;
            return (
              match.winner_side != null &&
              ((firstId === a.side.id && secondId === b.side.id) ||
                (firstId === b.side.id && secondId === a.side.id))
            );
          });
          if (direct?.winner_side) {
            const firstId = isTeam ? direct.team_one_id : direct.pair_one_id;
            const aWon =
              firstId === a.side.id ? direct.winner_side === 1 : direct.winner_side === 2;
            return aWon ? -1 : 1;
          }
          continue;
        }
        const difference = metric(b, key) - metric(a, key);
        if (difference) return difference;
      }
      const aName = 'name' in a.side ? a.side.name : a.side.player_one_name || '';
      const bName = 'name' in b.side ? b.side.name : b.side.player_one_name || '';
      return aName.localeCompare(bName);
    });
    const place = stats.findIndex((row) => row.side.id === entry.id) + 1;
    const expectedMatches = (groupEntries.length * (groupEntries.length - 1)) / 2;
    const allPlayed = expectedMatches > 0 && playedMatches.length >= expectedMatches;
    return `Group ${groupNumber} · ${allPlayed ? 'Place' : 'Current place'} ${place}`;
  }

  const knockoutSlotOptions: MemberOption[] = (() => {
    const groupCount = Math.max(2, Number(config?.group_count ?? 2));
    const promote = Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
    const category = isTeam ? 'team' : activeCategory;
    const roundRobinPhase = isTeam ? 'team_round_robin' : 'round_robin';
    const sides = isTeam
      ? teams
      : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === activeCategory);
    const completedGroups = new Set<number>();
    for (let group = 1; group <= groupCount; group += 1) {
      const groupEntries = sides.filter((side) => side.group_number === group);
      const expectedMatches = (groupEntries.length * (groupEntries.length - 1)) / 2;
      if (!expectedMatches) continue;
      const groupMatches = matches.filter(
        (match) =>
          match.category === category &&
          match.phase === roundRobinPhase &&
          match.group_number === group &&
          match.status !== 'cancelled',
      );
      if (
        groupMatches.length >= expectedMatches &&
        groupMatches.every((match) => match.status === 'completed' || match.winner_side != null)
      )
        completedGroups.add(group);
    }
    return Array.from({ length: groupCount * promote }, (_, index) => {
      const group = Math.floor(index / promote) + 1;
      const rank = (index % promote) + 1;
      const label = `Group ${group} Team ${rank}`;
      return { group, label, rank };
    })
      .filter(({ group }) => !completedGroups.has(group))
      .map(({ group, label, rank }) => ({
        id: `slot:${label}`,
        full_name: label,
        statusText: `Expected qualifier · Group ${group} · Place ${rank}`,
      }));
  })();

  function matchSideValue(match: Match, side: 1 | 2): string {
    const id = isTeam
      ? side === 1
        ? match.team_one_id
        : match.team_two_id
      : side === 1
        ? match.pair_one_id
        : match.pair_two_id;
    if (id) return id;
    // In a generated BYE match, winner_side identifies the real entrant.
    // Preselect BYE only on the opposing side, not on both empty-ID sides.
    if (match.status === 'bye' && match.winner_side && side !== match.winner_side) return 'bye';
    if (match.status === 'bye' && !match.winner_side && !id) return 'bye';
    try {
      const notes = JSON.parse(match.notes || '{}') as {
        slot_one?: string | null;
        slot_two?: string | null;
      };
      const label = side === 1 ? notes.slot_one : notes.slot_two;
      return label && /^Group \d+ Team \d+$/.test(label) ? `slot:${label}` : '';
    } catch {
      return '';
    }
  }

  function matchSideOptions(match: Match, side: 1 | 2): MemberOption[] {
    const otherId = isTeam
      ? side === 1
        ? match.team_two_id
        : match.team_one_id
      : side === 1
        ? match.pair_two_id
        : match.pair_one_id;
    const otherGroup = isTeam
      ? teams.find((team) => team.id === otherId)?.group_number
      : pairs.find((pair) => pair.id === otherId)?.group_number;
    const otherSlotValue = matchSideValue(match, side === 1 ? 2 : 1);
    const entries = (
      isTeam
        ? teams
        : pairs.filter((pair) => pair.status !== 'withdrawn' && pair.category === match.category)
    ).map((item): MemberOption => {
      const name = 'name' in item ? item.name : `${item.player_one_name} + ${item.player_two_name}`;
      const sameGroupRule =
        match.phase.includes('round_robin') && otherGroup && item.group_number !== otherGroup;
      const reason =
        item.id === otherId
          ? `Already selected as side ${side === 1 ? 'two' : 'one'}`
          : sameGroupRule
            ? 'Round-robin matches must stay within the same group'
            : '';
      return {
        id: item.id,
        full_name: name,
        statusText: match.phase.includes('knockout')
          ? groupPlaceDescription(item)
          : 'group_number' in item && item.group_number
            ? `Group ${item.group_number}`
            : 'No group assigned',
        available: !reason,
        unavailableReason: reason || undefined,
      };
    });
    if (!match.phase.includes('knockout')) return entries;
    const otherHasSide = !!otherId || !!otherSlotValue;
    const otherIsBye = otherSlotValue === 'bye';
    return [
      ...entries,
      ...knockoutSlotOptions.map((option) => ({
        ...option,
        available: option.id !== otherSlotValue,
        unavailableReason:
          option.id === otherSlotValue ? 'Already selected on the other side' : undefined,
      })),
      {
        id: 'bye',
        full_name: 'BYE — automatic advancement',
        statusText: 'Knockout only · the other side advances automatically',
        available: otherHasSide && !otherIsBye,
        unavailableReason: !otherHasSide
          ? 'Choose the opposing side first'
          : otherIsBye
            ? 'A match cannot have BYE on both sides'
            : undefined,
      },
    ];
  }

  function newMatchSideOptions(side: 1 | 2): MemberOption[] {
    const firstSlot = matchOne.startsWith('slot:') ? matchOne.slice(5) : null;
    const secondSlot = matchTwo.startsWith('slot:') ? matchTwo.slice(5) : null;
    const firstId = matchOne && !firstSlot && matchOne !== 'bye' ? matchOne : null;
    const secondId = matchTwo && !secondSlot && matchTwo !== 'bye' ? matchTwo : null;
    const newByeSide = matchOne === 'bye' ? 1 : matchTwo === 'bye' ? 2 : null;
    const context = {
      id: 'new-match',
      category: matchCategory,
      phase: matchPhase,
      group_number: null,
      round_number: 1,
      match_number: 0,
      pair_one_id: isTeam ? null : firstId,
      pair_two_id: isTeam ? null : secondId,
      team_one_id: isTeam ? firstId : null,
      team_two_id: isTeam ? secondId : null,
      scheduled_at: null,
      court_number: null,
      score_sets: [],
      winner_side: newByeSide === 1 ? 2 : newByeSide === 2 ? 1 : null,
      team_points_one: 0,
      team_points_two: 0,
      status: newByeSide ? 'bye' : 'scheduled',
      notes: JSON.stringify({ slot_one: firstSlot, slot_two: secondSlot }),
    } satisfies Match;
    return matchSideOptions(context, side);
  }

  return (
    <section className="space-y-6" aria-label="Tournament administration">
      {(error || message) && (
        <div
          className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
          aria-live="polite"
        >
          {error && (
            <p
              role="alert"
              className="pointer-events-auto rounded-md border border-destructive/30 bg-background p-3 text-sm text-destructive shadow-lg"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              role="status"
              className="pointer-events-auto rounded-md border border-emerald-600/30 bg-background p-3 text-sm shadow-lg"
            >
              {message}
            </p>
          )}
        </div>
      )}
      {externalTab !== 'competition' && adminTab === 'participants' && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="font-semibold">Participants</h3>
              <form onSubmit={addParticipant} className="space-y-2">
                <label className="block text-sm">
                  Existing member
                  <SearchableMemberSelect
                    value={memberId}
                    onChange={setMemberId}
                    placeholder={leagueTournament ? 'Search active members' : 'Search members'}
                    options={[...members]
                      .sort((a, b) => {
                        const category = isTeam ? 'team' : activeCategory;
                        const aMembershipBlocked =
                          leagueTournament && leagueMemberEligibility[a.id] !== true;
                        const bMembershipBlocked =
                          leagueTournament && leagueMemberEligibility[b.id] !== true;
                        const aGenderBlocked =
                          !isTeam && hasOpposingGenderProfile(a.gender, category);
                        const bGenderBlocked =
                          !isTeam && hasOpposingGenderProfile(b.gender, category);
                        const aRegistered = participants.some(
                          (p) =>
                            p.user_id === a.id &&
                            p.category === category &&
                            p.status === 'registered',
                        );
                        const bRegistered = participants.some(
                          (p) =>
                            p.user_id === b.id &&
                            p.category === category &&
                            p.status === 'registered',
                        );
                        return (
                          Number(aMembershipBlocked) - Number(bMembershipBlocked) ||
                          Number(aGenderBlocked) - Number(bGenderBlocked) ||
                          Number(aRegistered) - Number(bRegistered) ||
                          Number(hasOpposingGenderProfile(a.gender, category)) -
                            Number(hasOpposingGenderProfile(b.gender, category)) ||
                          (a.full_name || a.email).localeCompare(b.full_name || b.email)
                        );
                      })
                      .map((m): MemberOption => {
                        const selectedCategory = isTeam ? 'team' : activeCategory;
                        const existingEntries = participants.filter(
                          (p) =>
                            p.user_id === m.id &&
                            p.category === selectedCategory &&
                            p.status === 'registered',
                        );
                        const addedCategories = [
                          ...new Set(
                            existingEntries.map((p) =>
                              p.category === 'team' ? 'team roster' : `${p.category} doubles`,
                            ),
                          ),
                        ].join(', ');
                        const oppositeCategory =
                          selectedCategory === 'men'
                            ? 'women'
                            : selectedCategory === 'women'
                              ? 'men'
                              : null;
                        const oppositeEntry = oppositeCategory
                          ? participants.find(
                              (p) =>
                                p.user_id === m.id &&
                                p.category === oppositeCategory &&
                                p.status === 'registered',
                            )
                          : undefined;
                        const membershipBlocked =
                          leagueTournament && leagueMemberEligibility[m.id] !== true;
                        const genderBlocked =
                          !isTeam && hasOpposingGenderProfile(m.gender, selectedCategory);
                        const blockedReason = existingEntries.length
                          ? `Already added (${addedCategories})`
                          : oppositeEntry
                            ? `Already registered for ${oppositeCategory === 'men' ? "men's" : "women's"} doubles and cannot enter both`
                            : genderBlocked
                              ? `Profile gender does not match ${selectedCategory === 'men' ? "men's" : "women's"} doubles`
                              : membershipBlocked
                                ? 'Active paid membership required'
                                : undefined;
                        const genderLabel = profileGenderLabel(m.gender, selectedCategory);
                        const statusText =
                          [
                            genderLabel,
                            membershipBlocked ? 'Active paid membership required' : undefined,
                            genderBlocked
                              ? `Not eligible for ${selectedCategory === 'men' ? "men's" : "women's"} doubles`
                              : undefined,
                            blockedReason,
                          ]
                            .filter(Boolean)
                            .filter((text, index, all) => all.indexOf(text) === index)
                            .join(' · ') || undefined;
                        return {
                          id: m.id,
                          full_name: m.full_name || m.email,
                          email: m.email,
                          statusText,
                          sortPriority: membershipBlocked
                            ? 3
                            : genderBlocked
                              ? 2
                              : blockedReason
                                ? 1
                                : genderLabel
                                  ? 1
                                  : 0,
                          available: !blockedReason,
                          unavailableReason: statusText,
                        };
                      })}
                  />
                </label>
                {!memberId && !leagueTournament && (
                  <>
                    <Input
                      placeholder="Full name"
                      value={participantName}
                      onChange={(e) => setParticipantName(e.target.value)}
                      required
                    />
                    <Input
                      type="email"
                      placeholder="Email (private)"
                      value={participantEmail}
                      onChange={(e) => setParticipantEmail(e.target.value)}
                    />
                    <Input
                      placeholder="Phone (private)"
                      value={participantPhone}
                      onChange={(e) => setParticipantPhone(e.target.value)}
                    />
                    <label className="block text-sm">
                      Gender profile
                      <select
                        className="block h-10 w-full rounded-md border border-input bg-background px-3"
                        value={participantGender}
                        onChange={(e) => setParticipantGender(e.target.value)}
                      >
                        <option value="">Not specified</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </label>
                  </>
                )}
                <Button disabled={busy || (leagueTournament && !memberId)} type="submit">
                  Add participant
                </Button>
              </form>
              <div className="space-y-3">
                <h4 className="font-semibold">
                  Registered participants (
                  {
                    participants.filter(
                      (p) => p.status === 'registered' && (isTeam || p.category === activeCategory),
                    ).length
                  }
                  )
                </h4>
                {participants
                  .filter(
                    (p) => p.status === 'registered' && (isTeam || p.category === activeCategory),
                  )
                  .map((p) => (
                    <div
                      key={p.id}
                      className={`grid gap-2 rounded-md bg-secondary/40 p-2 text-sm ${isTeam ? 'sm:grid-cols-[minmax(0,1fr)_10rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{p.display_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.user_id ? 'Member' : 'Non-member'} ·{' '}
                            {priceCents > 0 && p.payment_status === 'pending'
                              ? 'Pending'
                              : p.status}
                          </p>
                          {priceCents > 0 && p.payment_status === 'pending' && (
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                              Pending payment — registration is awaiting payment confirmation.
                            </p>
                          )}
                        </div>
                      </div>
                      {isTeam && (
                        <select
                          aria-label={`Team for ${p.display_name}`}
                          className="h-9 rounded-md border border-input bg-background px-2"
                          value={p.team_id ?? ''}
                          disabled={!isTeam}
                          onChange={(e) =>
                            void runAction(
                              () =>
                                db
                                  .from('tournament_participants')
                                  .update({ team_id: e.target.value || null })
                                  .eq('id', p.id),
                              'Team assignment updated.',
                            )
                          }
                        >
                          <option value="">No team</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <details
                        className="relative shrink-0"
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                            e.currentTarget.open = false;
                        }}
                        data-tournament-menu="true"
                      >
                        <summary
                          className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded border border-border text-lg leading-none"
                          aria-label={`More actions for ${p.display_name}`}
                        >
                          ⋮
                        </summary>
                        <div className="absolute right-0 z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] space-y-2 rounded-md border border-border bg-background p-3 shadow-lg">
                          {!leagueTournament && (
                            <label className="block text-xs">
                              Tournament gender override
                              <select
                                aria-label={`Gender override for ${p.display_name}`}
                                className="mt-1 block h-8 rounded-md border border-input bg-background px-2"
                                value={p.gender_override ?? ''}
                                onChange={(e) =>
                                  void runAction(
                                    () =>
                                      db
                                        .from('tournament_participants')
                                        .update({ gender_override: e.target.value || null })
                                        .eq('id', p.id),
                                    'Gender eligibility override updated.',
                                  )
                                }
                              >
                                <option value="">
                                  Use profile gender ({p.gender || 'not set'})
                                </option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                              </select>
                            </label>
                          )}
                          <label className="block text-xs">
                            Entry payment
                            <select
                              aria-label={`Payment status for ${p.display_name}`}
                              className="mt-1 block h-8 rounded-md border border-input bg-background px-2"
                              value={p.payment_status}
                              onChange={(e) =>
                                void runAction(
                                  () =>
                                    db
                                      .from('tournament_participants')
                                      .update({ payment_status: e.target.value })
                                      .eq('id', p.id),
                                  'Entry payment status updated.',
                                )
                              }
                            >
                              <option value="not_required">Not required</option>
                              <option value="pending">Pending</option>
                              <option value="paid">Paid</option>
                              <option value="refunded">Refunded</option>
                              <option value="failed">Failed</option>
                            </select>
                          </label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingRemoveParticipant(p)}
                          >
                            Remove player
                          </Button>
                        </div>
                      </details>
                    </div>
                  ))}
              </div>
            </div>
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{isTeam ? 'Teams and captains' : 'Doubles pairs'}</h3>
                {!leagueTournament && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      busy ||
                      !(isTeam
                        ? teams.length
                        : pairs.some(
                            (pair) =>
                              pair.category === activeCategory && pair.status !== 'withdrawn',
                          ))
                    }
                    onClick={() => void randomizeGroups()}
                  >
                    Random group draw
                  </Button>
                )}
              </div>
              {isTeam && unevenTeams && (
                <p
                  role="alert"
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                >
                  Team rosters are uneven by more than one player. Try to distribute players evenly;
                  a difference of one is acceptable.
                </p>
              )}
              {isTeam ? (
                <>
                  <form onSubmit={addTeam} className="space-y-2">
                    <Input
                      placeholder="Team name"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      required
                    />
                    <Input
                      placeholder="Team colour (e.g. all blacks)"
                      value={teamColor}
                      onChange={(e) => setTeamColor(e.target.value)}
                    />
                    <Input
                      placeholder="Team logo URL (optional)"
                      value={teamLogo}
                      onChange={(e) => setTeamLogo(e.target.value)}
                    />
                    <label className="block text-sm">
                      Captain
                      <SearchableMemberSelect
                        value={captain}
                        onChange={setCaptain}
                        placeholder="Search captains"
                        options={members.map((m): MemberOption => ({
                          id: m.id,
                          full_name: m.full_name || m.email,
                          email: m.email,
                          statusText: 'Eligible club member',
                        }))}
                      />
                    </label>
                    <Button type="submit" disabled={busy}>
                      Create team
                    </Button>
                  </form>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">Teams</p>
                    </div>
                    {teams.map((t) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData('application/x-pctc-team-id', t.id)
                        }
                        className="rounded-md border border-border p-3"
                      >
                        <div className="flex items-center gap-3">
                          {t.logo_url && (
                            <Image
                              src={t.logo_url}
                              alt={t.name}
                              width={36}
                              height={36}
                              unoptimized
                              className="h-9 w-9 rounded object-contain"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{t.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {t.color || 'No colour set'} ·{' '}
                              {
                                participants.filter(
                                  (p) =>
                                    p.team_id === t.id &&
                                    p.category === 'team' &&
                                    p.status === 'registered',
                                ).length
                              }{' '}
                              players
                            </p>
                          </div>
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            Group
                            <select
                              aria-label={`Group for ${t.name}`}
                              className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
                              value={t.group_number ?? ''}
                              onChange={(event) =>
                                void runAction(
                                  () =>
                                    saveEntryGroup(
                                      t.id,
                                      event.target.value ? Number(event.target.value) : null,
                                    ),
                                  'Group assignment updated.',
                                )
                              }
                            >
                              <option value="">Unassigned</option>
                              {Array.from(
                                { length: Math.max(1, Number(config?.group_count ?? 2)) },
                                (_, index) => index + 1,
                              ).map((group) => (
                                <option key={group} value={group}>
                                  Group {group}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {activeCategory === 'mixed' &&
                    (() => {
                      const registered = participants.filter(
                        (p) => p.category === 'mixed' && p.status === 'registered',
                      );
                      const men = registered.filter(
                        (p) => (p.gender_override || p.gender) === 'male',
                      ).length;
                      const women = registered.filter(
                        (p) => (p.gender_override || p.gender) === 'female',
                      ).length;
                      return men !== women ? (
                        <p
                          role="status"
                          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                        >
                          Mixed doubles registrations are currently unbalanced: {women} women and{' '}
                          {men} men. Players with unspecified gender are not included in this count.
                        </p>
                      ) : null;
                    })()}
                  <form onSubmit={createPair} className="space-y-2">
                    <label className="block text-sm">
                      Player one
                      <SearchableMemberSelect
                        value={pairOne}
                        onChange={setPairOne}
                        placeholder="Choose player"
                        options={availablePairPlayers
                          .filter((p) => p.category === pairCategory)
                          .map((p): MemberOption => {
                            const reason = pairPlayerRestriction(p, pairTwo);
                            const genderLabel = profileGenderLabel(p.gender, pairCategory);
                            const statusText =
                              [genderLabel, reason].filter(Boolean).join(' · ') || undefined;
                            return {
                              id: p.id,
                              full_name: p.display_name,
                              statusText,
                              sortPriority: genderLabel ? 1 : 0,
                              available: !reason,
                              unavailableReason: reason || undefined,
                            };
                          })}
                      />
                    </label>
                    <label className="block text-sm">
                      Player two
                      <SearchableMemberSelect
                        value={pairTwo}
                        onChange={setPairTwo}
                        placeholder="Choose partner"
                        options={availablePairPlayers
                          .filter((p) => p.category === pairCategory)
                          .map((p): MemberOption => {
                            const reason = pairPlayerRestriction(p, pairOne);
                            const genderLabel = profileGenderLabel(p.gender, pairCategory);
                            const statusText =
                              [genderLabel, reason].filter(Boolean).join(' · ') || undefined;
                            return {
                              id: p.id,
                              full_name: p.display_name,
                              statusText,
                              sortPriority: genderLabel ? 1 : 0,
                              available: !reason,
                              unavailableReason: reason || undefined,
                            };
                          })}
                      />
                    </label>
                    <Button type="submit" disabled={busy}>
                      Create pair
                    </Button>
                  </form>
                  <div className="space-y-2">
                    {pairs
                      .filter((p) => p.status !== 'withdrawn' && p.category === activeCategory)
                      .map((p) => (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData('application/x-pctc-pair-id', p.id)
                          }
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm"
                        >
                          <span className="min-w-0 flex-1 font-medium">
                            {p.player_one_name} + {p.player_two_name}
                          </span>
                          {!leagueTournament && (
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              Group
                              <select
                                aria-label={`Group for ${p.player_one_name} and ${p.player_two_name}`}
                                className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
                                value={p.group_number ?? ''}
                                onChange={(event) =>
                                  void runAction(
                                    () =>
                                      saveEntryGroup(
                                        p.id,
                                        event.target.value ? Number(event.target.value) : null,
                                      ),
                                    'Group assignment updated.',
                                  )
                                }
                              >
                                <option value="">Unassigned</option>
                                {Array.from(
                                  { length: Math.max(1, Number(config?.group_count ?? 2)) },
                                  (_, index) => index + 1,
                                ).map((group) => (
                                  <option key={group} value={group}>
                                    Group {group}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <details
                            className="relative shrink-0"
                            onBlur={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                                e.currentTarget.open = false;
                            }}
                            data-tournament-menu="true"
                          >
                            <summary
                              className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded border border-border text-lg leading-none"
                              aria-label={`Actions for ${p.player_one_name} and ${p.player_two_name}`}
                            >
                              ⋮
                            </summary>
                            <div className="absolute right-0 z-50 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-md border border-border bg-background p-2 shadow-lg">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setReplacementParticipantId('');
                                  setReplaceTarget({ pair: p, side: 1 });
                                }}
                              >
                                Replace {p.player_one_name}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setReplacementParticipantId('');
                                  setReplaceTarget({ pair: p, side: 2 });
                                }}
                              >
                                Replace {p.player_two_name}
                              </Button>
                            </div>
                          </details>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {externalTab !== 'competition' && adminTab === 'matches' && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Matches, scheduling and results</h3>
            <div className="flex flex-wrap items-center gap-2">
              {matchPhase === (isTeam ? 'team_round_robin' : 'round_robin') && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy ||
                    matches.some(
                      (m) =>
                        m.category === matchCategory &&
                        m.phase === matchPhase &&
                        ((m.score_sets?.length ?? 0) > 0 ||
                          m.winner_side != null ||
                          m.status === 'completed'),
                    )
                  }
                  onClick={() => void generateSchedule()}
                >
                  {busy ? <TennisLoader label="Scheduling" compact /> : 'Suggest schedule'}
                </Button>
              )}
              {(matchPhase === (isTeam ? 'team_knockout' : 'final_knockout') ||
                matchPhase === 'preliminary_knockout') && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy ||
                    matches.some(
                      (m) =>
                        m.category === matchCategory &&
                        m.phase.includes('knockout') &&
                        ((m.score_sets?.length ?? 0) > 0 ||
                          m.winner_side != null ||
                          m.status === 'completed'),
                    )
                  }
                  onClick={() => void randomizeKnockoutDraw()}
                >
                  {busy ? <TennisLoader label="Creating draw" compact /> : 'Create draw'}
                </Button>
              )}
              {(matchPhase === (isTeam ? 'team_round_robin' : 'round_robin') ||
                matchPhase === (isTeam ? 'team_knockout' : 'final_knockout') ||
                matchPhase === 'preliminary_knockout') &&
                availableMatchPhases.length > 1 && (
                  <span aria-hidden="true" className="mx-1 h-7 border-l border-border" />
                )}
              {availableMatchPhases.length > 1 && (
                <div
                  className="inline-flex rounded-md border border-border p-1"
                  role="group"
                  aria-label="Match schedule phase"
                >
                  {availableMatchPhases.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={matchPhase === key}
                      onClick={() => setMatchPhase(key)}
                      className={`rounded px-3 py-2 text-sm ${matchPhase === key ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
                    >
                      {label.replace('Team ', '')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Suggested start times are between 8:00 AM and 9:00 PM, with configurable match length
            and breaks. Every match remains editable or deletable by administrators.
          </p>
          {isRoundRobinPhase && (
            <div
              className="inline-flex rounded-md border border-border p-1"
              role="group"
              aria-label="Group round-robin matches by"
            >
              {(['group', 'round'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={matchGrouping === mode}
                  onClick={() => setMatchGrouping(mode)}
                  className={`rounded px-3 py-2 text-sm ${matchGrouping === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
                >
                  By {mode}
                </button>
              ))}
            </div>
          )}
          {bracketNeedsRedraw && (
            <p
              role="status"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
              The participant count has changed since this knockout bracket was generated.{' '}
              {knockoutBracketHasResults
                ? 'Results exist, so the bracket cannot be regenerated; edit it manually.'
                : 'Use Create draw to regenerate the bracket and schedule, or edit the bracket manually.'}
            </p>
          )}
          <form onSubmit={createMatch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              Side one
              <SearchableMemberSelect
                value={matchOne}
                onChange={setMatchOne}
                placeholder="Choose side one"
                options={newMatchSideOptions(1)}
              />
            </label>
            <label className="text-sm">
              Side two
              <SearchableMemberSelect
                value={matchTwo}
                onChange={setMatchTwo}
                placeholder="Choose side two"
                options={newMatchSideOptions(2)}
              />
            </label>
            <label className="text-sm">
              Date and time (optional)
              <Input
                type="datetime-local"
                value={matchTime}
                onChange={(e) => setMatchTime(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Court (optional)
              <select
                className="block h-10 w-full rounded-md border border-input bg-background px-3"
                value={matchCourt}
                onChange={(e) => setMatchCourt(e.target.value)}
              >
                <option value="">Unassigned</option>
                {Array.from({ length: Math.max(1, courtCount) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Court {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <Button disabled={busy} type="submit">
                Add match
              </Button>
            </div>
          </form>
          <div className="space-y-3">
            <div>
              <h4 className="font-medium">Court assignment</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Drag a match to a court, or use the court selector on the match below.
              </p>
              {courtScheduleConflicts.length > 0 && (
                <div className="mt-3 space-y-2" role="status" aria-live="polite">
                  {courtScheduleConflicts.some((item) => item.severity === 'danger') && (
                    <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                      <p className="font-semibold">Scheduling conflicts — immediate overlap</p>
                      {courtScheduleConflicts
                        .filter((item) => item.severity === 'danger')
                        .map((item) => (
                          <p key={`${item.court}-${item.current.id}`} className="mt-1">
                            Court {item.court}: {matchCourtTileNames(item.previous).players} (
                            {formatDateTime(item.previous.scheduled_at!)}) overlaps with{' '}
                            {matchCourtTileNames(item.current).players} (
                            {formatDateTime(item.current.scheduled_at!)}).
                          </p>
                        ))}
                    </div>
                  )}
                  {courtScheduleConflicts.some((item) => item.severity === 'warning') && (
                    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                      <p className="font-semibold">Scheduling warnings — insufficient break</p>
                      {courtScheduleConflicts
                        .filter((item) => item.severity === 'warning')
                        .map((item) => (
                          <p key={`${item.court}-${item.current.id}`} className="mt-1">
                            Court {item.court}: insufficient break between{' '}
                            {matchCourtTileNames(item.previous).players} (
                            {formatDateTime(item.previous.scheduled_at!)}) and{' '}
                            {matchCourtTileNames(item.current).players} (
                            {formatDateTime(item.current.scheduled_at!)}).
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: Math.max(1, courtCount) }, (_, index) => index + 1).map(
                  (court) => (
                    <div
                      key={court}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const matchId = e.dataTransfer.getData('application/x-pctc-match-id');
                        const match = matches.find((item) => item.id === matchId);
                        if (match) void moveMatchToCourt(match, court);
                      }}
                      className="min-h-32 rounded-md border border-dashed border-border bg-secondary/20 p-2"
                    >
                      <p className="text-sm font-semibold">Court {court}</p>
                      <div className="mt-2 space-y-2">
                        {matches
                          .filter(
                            (match) => match.court_number === court && match.status !== 'cancelled',
                          )
                          .sort(
                            (a, b) =>
                              (a.scheduled_at
                                ? new Date(a.scheduled_at).getTime()
                                : Number.MAX_SAFE_INTEGER) -
                              (b.scheduled_at
                                ? new Date(b.scheduled_at).getTime()
                                : Number.MAX_SAFE_INTEGER),
                          )
                          .map((match) => {
                            const names = matchCourtTileNames(match);
                            return (
                              <div
                                key={match.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('application/x-pctc-match-id', match.id);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                className="cursor-grab rounded-md border border-border bg-background px-2 py-2 text-xs shadow-sm active:cursor-grabbing"
                                title="Drag to another court to reassign"
                              >
                                <p className="font-semibold">
                                  {match.scheduled_at
                                    ? formatDateTime(match.scheduled_at)
                                    : 'Time not scheduled'}
                                </p>
                                <p className="mt-1 leading-snug text-muted-foreground">
                                  {names.players} · {names.stage}
                                </p>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
            {adminMatchList.map((m, index, list) => {
              const knockoutPhase = matchPhase.includes('knockout');
              const groupKey = knockoutPhase
                ? String(m.round_number)
                : matchGrouping === 'group'
                  ? String(m.group_number ?? 'unassigned')
                  : String(adminRoundByMatch.get(m.id) ?? m.round_number);
              const previous = index > 0 ? list[index - 1] : null;
              const previousKey = previous
                ? knockoutPhase
                  ? String(previous.round_number)
                  : matchGrouping === 'group'
                    ? String(previous.group_number ?? 'unassigned')
                    : String(adminRoundByMatch.get(previous.id) ?? previous.round_number)
                : null;
              const showGroupTitle =
                (isRoundRobinPhase || knockoutPhase) && (index === 0 || groupKey !== previousKey);
              const maxStageRound = Math.max(1, ...list.map((item) => item.round_number));
              const groupTitle = knockoutPhase
                ? knockoutStageLabel(m.round_number, maxStageRound)
                : matchGrouping === 'group'
                  ? m.group_number
                    ? `Group ${m.group_number}`
                    : 'Unassigned group'
                  : `Round ${adminRoundByMatch.get(m.id) ?? m.round_number}`;
              const sideName = (side: 1 | 2): string => {
                const id = isTeam
                  ? side === 1
                    ? m.team_one_id
                    : m.team_two_id
                  : side === 1
                    ? m.pair_one_id
                    : m.pair_two_id;
                if (id) {
                  if (isTeam) return teams.find((team) => team.id === id)?.name || 'TBD';
                  const pair = pairs.find((item) => item.id === id);
                  if (pair) return `${pair.player_one_name} + ${pair.player_two_name}`;
                }
                const phaseMatches = matches.filter(
                  (item) => item.category === m.category && item.phase === m.phase,
                );
                const maxRound = Math.max(1, ...phaseMatches.map((item) => item.round_number));
                if (m.round_number > 1) {
                  const previousRound = m.round_number - 1;
                  const previousMatchNumber = (m.match_number - 1) * 2 + side;
                  const previous = phaseMatches.find(
                    (item) =>
                      item.round_number === previousRound &&
                      item.match_number === previousMatchNumber,
                  );
                  if (previous?.winner_side) {
                    const winnerId = isTeam
                      ? previous.winner_side === 1
                        ? previous.team_one_id
                        : previous.team_two_id
                      : previous.winner_side === 1
                        ? previous.pair_one_id
                        : previous.pair_two_id;
                    if (winnerId)
                      return isTeam
                        ? teams.find((team) => team.id === winnerId)?.name ||
                            `Winner of ${knockoutStageLabel(previousRound, maxRound)} ${previousMatchNumber}`
                        : (() => {
                            const pair = pairs.find((item) => item.id === winnerId);
                            return pair
                              ? `${pair.player_one_name} + ${pair.player_two_name}`
                              : `Winner of ${knockoutStageLabel(previousRound, maxRound)} ${previousMatchNumber}`;
                          })();
                  }
                  return `Winner of ${knockoutStageLabel(previousRound, maxRound)} ${previousMatchNumber}`;
                }
                try {
                  const notes = JSON.parse(m.notes || '{}') as {
                    slot_one?: string | null;
                    slot_two?: string | null;
                  };
                  return (side === 1 ? notes.slot_one : notes.slot_two) || 'TBD';
                } catch {
                  return 'TBD';
                }
              };
              const scoreText = (m.score_sets ?? [])
                .map((set) => `${set.one}-${set.two}`)
                .join(', ');
              return (
                <div key={m.id} className="space-y-2">
                  {showGroupTitle && (
                    <h4 className="pt-2 text-sm font-semibold text-muted-foreground">
                      {groupTitle}
                    </h4>
                  )}
                  <div
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/x-pctc-match-id', m.id)}
                    className="space-y-3 rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {sideName(1)} vs {sideName(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const phaseMatches = matches.filter(
                              (item) => item.category === m.category && item.phase === m.phase,
                            );
                            const maxRound = Math.max(
                              1,
                              ...phaseMatches.map((item) => item.round_number),
                            );
                            if (m.phase.includes('round_robin'))
                              return `Match ${m.match_number} · ${m.status === 'bye' ? 'BYE — automatic advancement' : m.status}`;
                            const stage = knockoutStageLabel(m.round_number, maxRound);
                            return `${stage} ${m.match_number} · ${m.status === 'bye' ? 'BYE — automatic advancement' : m.status}`;
                          })()}
                        </p>
                      </div>
                      <details className="relative shrink-0" data-tournament-menu="true">
                        <summary
                          aria-label={`Actions for match ${m.match_number}`}
                          className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-input hover:bg-secondary [&::-webkit-details-marker]:hidden"
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </summary>
                        <div className="absolute right-0 z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] flex flex-col rounded-md border border-border bg-background p-1 shadow-lg">
                          <button
                            type="button"
                            className="rounded px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
                            disabled={busy}
                            onClick={() => void deleteMatch(m)}
                          >
                            Delete match
                          </button>
                          <button
                            type="button"
                            className="rounded px-3 py-2 text-left text-sm hover:bg-secondary"
                            disabled={busy || !(m.pair_one_id || m.team_one_id)}
                            onClick={() => void recordWalkover(m, 1)}
                          >
                            Walkover: side one
                          </button>
                          <button
                            type="button"
                            className="rounded px-3 py-2 text-left text-sm hover:bg-secondary"
                            disabled={busy || !(m.pair_two_id || m.team_two_id)}
                            onClick={() => void recordWalkover(m, 2)}
                          >
                            Walkover: side two
                          </button>
                        </div>
                      </details>
                    </div>
                    {m.status === 'bye' && (
                      <div
                        role="status"
                        className="rounded-md border-2 border-amber-500 bg-amber-500/10 px-4 py-3 text-sm"
                      >
                        <p className="font-bold tracking-wide">BYE — AUTOMATIC ADVANCEMENT</p>
                        <p className="mt-1">
                          This is not a played match. Score entry is disabled; the opposing side
                          advances automatically.
                        </p>
                      </div>
                    )}
                    {m.status !== 'completed' && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs">
                          Side one draw
                          <SearchableMemberSelect
                            value={matchSideValue(m, 1)}
                            onChange={(value) => void changeMatchSide(m, 1, value)}
                            placeholder="Choose side one or a group slot"
                            options={matchSideOptions(m, 1)}
                          />
                        </label>
                        <label className="block text-xs">
                          Side two draw
                          <SearchableMemberSelect
                            value={matchSideValue(m, 2)}
                            onChange={(value) => void changeMatchSide(m, 2, value)}
                            placeholder="Choose side two or a group slot"
                            options={matchSideOptions(m, 2)}
                          />
                        </label>
                      </div>
                    )}
                    <div className="grid items-start gap-3 sm:grid-cols-3">
                      <label className="flex min-w-0 flex-col gap-1 text-xs">
                        Date/time
                        <Input
                          className="h-10"
                          type="datetime-local"
                          value={localDateTime(m.scheduled_at)}
                          onChange={(e) =>
                            void saveMatch(m, {
                              scheduled_at: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            })
                          }
                        />
                        {m.scheduled_at && (
                          <span className="text-muted-foreground">
                            Scheduled end:{' '}
                            {formatTime(
                              new Date(
                                new Date(m.scheduled_at).getTime() +
                                  Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) *
                                    60000,
                              ),
                            )}
                          </span>
                        )}
                      </label>
                      <label className="flex min-w-0 flex-col gap-1 text-xs">
                        Court
                        <select
                          className="block h-10 w-full rounded-md border border-input bg-background px-3"
                          value={m.court_number ?? ''}
                          onChange={(e) =>
                            void moveMatchToCourt(m, e.target.value ? Number(e.target.value) : null)
                          }
                        >
                          <option value="">Unassigned</option>
                          {Array.from({ length: Math.max(1, courtCount) }, (_, i) => i + 1).map(
                            (n) => (
                              <option key={n} value={n}>
                                Court {n}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label className="flex min-w-0 flex-col gap-1 text-xs">
                        Set scores (e.g. 6-4, 3-6, 10-8)
                        <Input
                          className="h-10"
                          key={`${m.id}-${scoreText}`}
                          defaultValue={scoreText}
                          placeholder={m.status === 'bye' ? 'Unavailable for BYE' : '6-4, 6-3'}
                          disabled={m.status === 'bye'}
                          onBlur={(e) => {
                            if (e.target.value !== scoreText) void saveScore(m, e.target.value);
                          }}
                        />
                      </label>
                    </div>
                    {isTeam && m.status !== 'completed' && m.status !== 'cancelled' && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {([1, 2] as const).map((side) => {
                          const teamId = side === 1 ? m.team_one_id : m.team_two_id;
                          if (!teamId) return null;
                          const roster = activeParticipants.filter(
                            (participant) =>
                              participant.team_id === teamId && participant.category === 'team',
                          );
                          const currentPair = matchPlayers.filter(
                            (player) => player.match_id === m.id && player.team_id === teamId,
                          );
                          return (
                            <div
                              key={`${m.id}-team-pair-${side}`}
                              className="rounded-md bg-secondary/30 p-3"
                            >
                              <p className="text-xs font-semibold">{sideName(side)} pairing</p>
                              <div className="mt-2 grid gap-2">
                                <SearchableMemberSelect
                                  value={
                                    teamPairSelection[`${m.id}-${side}`]?.first ??
                                    currentPair[0]?.participant_id ??
                                    ''
                                  }
                                  onChange={(value) =>
                                    setTeamPairSelection((previous) => ({
                                      ...previous,
                                      [`${m.id}-${side}`]: {
                                        first: value,
                                        second:
                                          previous[`${m.id}-${side}`]?.second ??
                                          currentPair[1]?.participant_id ??
                                          '',
                                      },
                                    }))
                                  }
                                  placeholder="Choose player one"
                                  options={roster.map((participant): MemberOption => ({
                                    id: participant.id,
                                    full_name: participant.display_name,
                                    statusText: 'Team roster member',
                                  }))}
                                />
                                <SearchableMemberSelect
                                  value={
                                    teamPairSelection[`${m.id}-${side}`]?.second ??
                                    currentPair[1]?.participant_id ??
                                    ''
                                  }
                                  onChange={(value) =>
                                    setTeamPairSelection((previous) => ({
                                      ...previous,
                                      [`${m.id}-${side}`]: {
                                        first:
                                          previous[`${m.id}-${side}`]?.first ??
                                          currentPair[0]?.participant_id ??
                                          '',
                                        second: value,
                                      },
                                    }))
                                  }
                                  placeholder="Choose player two"
                                  options={roster.map((participant): MemberOption => {
                                    const firstId =
                                      teamPairSelection[`${m.id}-${side}`]?.first ??
                                      currentPair[0]?.participant_id ??
                                      '';
                                    const reason =
                                      participant.id === firstId
                                        ? 'Already selected as player one'
                                        : '';
                                    return {
                                      id: participant.id,
                                      full_name: participant.display_name,
                                      statusText: reason || 'Team roster member',
                                      available: !reason,
                                      unavailableReason: reason || undefined,
                                    };
                                  })}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => void saveTeamPairing(m, teamId, side)}
                                >
                                  Save pairing
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {isTeam && (
                      <p className="text-xs text-muted-foreground">
                        Team standings points: {m.team_points_one} – {m.team_points_two}. Score
                        edits are immediately applied; administrators can correct them at any time.
                      </p>
                    )}
                    {m.notes &&
                      (() => {
                        try {
                          const parsed = JSON.parse(m.notes) as Record<string, unknown>;
                          if (
                            parsed &&
                            typeof parsed === 'object' &&
                            ('slot_one' in parsed || 'slot_two' in parsed)
                          )
                            return null;
                        } catch {
                          // Non-JSON notes are normal user-facing notes and should remain visible.
                        }
                        const isWalkoverNote =
                          /^Walkover \/ retirement awarded to side (one|two)$/i.test(
                            m.notes.trim(),
                          );
                        return isWalkoverNote ? (
                          <div
                            role="status"
                            className="mt-2 rounded-md border border-amber-500/60 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                          >
                            {m.notes}
                          </div>
                        ) : (
                          <p className="text-sm">{m.notes}</p>
                        );
                      })()}
                  </div>
                </div>
              );
            })}
            {!adminMatchList.length && (
              <p className="text-sm text-muted-foreground">No matches created yet.</p>
            )}
          </div>
        </div>
      )}
      {externalTab !== 'competition' && adminTab === 'audit' && (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-semibold">
            Tournament audit log ({visibleAuditRows.length} recent changes)
          </h3>
          <div className="mt-3 space-y-2">
            {visibleAuditRows.map((row) => {
              const entityName = row.entity_type.includes('participant')
                ? participants.find((item) => item.id === row.entity_id)?.display_name
                : row.entity_type.includes('team')
                  ? teams.find((item) => item.id === row.entity_id)?.name
                  : row.entity_type.includes('pair')
                    ? (() => {
                        const pair = pairs.find((item) => item.id === row.entity_id);
                        return pair
                          ? `${pair.player_one_name} + ${pair.player_two_name}`
                          : 'Doubles pair';
                      })()
                    : row.entity_type.includes('match')
                      ? (() => {
                          const match = matches.find((item) => item.id === row.entity_id);
                          return match
                            ? `${match.category} ${match.phase.replaceAll('_', ' ')} match ${match.match_number}`
                            : 'Match';
                        })()
                      : row.entity_type.replaceAll('tournament_', '').replaceAll('_', ' ');
              const actorName =
                members.find((member) => member.id === row.actor_user_id)?.full_name ||
                'Club administrator';
              const summarize = (data: Record<string, unknown> | null) => {
                if (!data) return '';
                const labels: Record<string, string> = {
                  name: 'Name',
                  display_name: 'Participant',
                  category: 'Category',
                  status: 'Status',
                  payment_status: 'Payment status',
                  group_number: 'Group',
                  scheduled_at: 'Scheduled for',
                  court_number: 'Court',
                  score_sets: 'Set scores',
                  winner_side: 'Winner side',
                  team_points_one: 'Team one points',
                  team_points_two: 'Team two points',
                  color: 'Team colour',
                };
                return Object.entries(data)
                  .filter(([key, value]) => labels[key] && value !== null)
                  .map(([key, value]) => {
                    if (key === 'score_sets' && Array.isArray(value))
                      return `${labels[key]}: ${value.map((set) => (set && typeof set === 'object' ? `${String((set as { one?: unknown }).one)}-${String((set as { two?: unknown }).two)}` : '')).join(', ')}`;
                    if (key === 'scheduled_at' && typeof value === 'string')
                      return `${labels[key]}: ${formatDateTime(value)}`;
                    if (typeof value === 'object') return '';
                    return `${labels[key]}: ${String(value)}`;
                  })
                  .filter(Boolean)
                  .join(' · ');
              };
              return (
                <article key={row.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      {row.action.replaceAll('_', ' ').charAt(0).toUpperCase() +
                        row.action.replaceAll('_', ' ').slice(1)}{' '}
                      ·{' '}
                      {(entityName || 'Tournament record').charAt(0).toUpperCase() +
                        (entityName || 'Tournament record').slice(1)}
                    </span>
                    <time className="text-xs text-muted-foreground">
                      {formatDateTime(row.created_at)}
                    </time>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">By {actorName}</p>
                  {(summarize(row.before_data) || summarize(row.after_data)) && (
                    <div className="mt-3 space-y-2 text-sm">
                      {summarize(row.before_data) && (
                        <div className="rounded-md bg-secondary/40 p-2">
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Before
                          </p>
                          <p>{summarize(row.before_data)}</p>
                        </div>
                      )}
                      {summarize(row.after_data) && (
                        <div className="rounded-md bg-emerald-600/5 p-2">
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            After
                          </p>
                          <p>{summarize(row.after_data)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {!auditRows.length && (
              <p className="text-sm text-muted-foreground">
                No tournament changes have been logged yet.
              </p>
            )}
          </div>
        </section>
      )}
      <ConfirmDialog
        open={!!pendingScheduleConflicts}
        title="Schedule conflict detected"
        description={`This change conflicts with ${pendingScheduleConflicts?.conflicts.length ?? 0} other match(es) because of court or player availability. Move the conflicting matches forward automatically? Matches that cannot fit before the tournament ends will require manual adjustment.`}
        confirmLabel="Move conflicting matches"
        busy={busy}
        onCancel={() => setPendingScheduleConflicts(null)}
        onConfirm={() => void confirmResolveScheduleConflicts()}
      />
      <ConfirmDialog
        open={!!pendingCourtMove}
        title="Court schedule conflict detected"
        description={
          pendingCourtMove
            ? `Moving this match to Court ${pendingCourtMove.court} creates scheduling conflict. Save this court assignment anyway? Other matches will not be moved.`
            : ''
        }
        confirmLabel="Save assignment anyway"
        busy={busy}
        onCancel={() => setPendingCourtMove(null)}
        onConfirm={() => void confirmCourtMove()}
      />
      <ConfirmDialog
        open={!!pendingRemoveParticipant}
        title="Remove player from this category?"
        description={
          pendingRemoveParticipant
            ? `Withdraw ${pendingRemoveParticipant.display_name} from this category. Unplayed doubles matches involving their pair will be cancelled; completed match history will be preserved.`
            : ''
        }
        confirmLabel="Remove player"
        destructive
        busy={busy}
        onCancel={() => setPendingRemoveParticipant(null)}
        onConfirm={() => {
          const target = pendingRemoveParticipant;
          setPendingRemoveParticipant(null);
          if (target) void removeParticipant(target);
        }}
      />
      <ConfirmDialog
        open={!!pendingWalkoverScore}
        title="Replace walkover result?"
        description="This match has been awarded as a walkover or retirement. Saving these set scores will replace that result and remove the walkover notice. Continue?"
        confirmLabel="Save score"
        busy={busy}
        onCancel={() => setPendingWalkoverScore(null)}
        onConfirm={() => {
          const pending = pendingWalkoverScore;
          setPendingWalkoverScore(null);
          if (pending) void saveScore(pending.match, pending.raw, true);
        }}
      />
      <ConfirmDialog
        open={!!pendingDeleteMatch}
        title="Delete match?"
        description="Delete this match? This action can not be undone."
        confirmLabel="Delete match"
        destructive
        busy={busy}
        onCancel={() => setPendingDeleteMatch(null)}
        onConfirm={() => void confirmDeleteMatch()}
      />
      {replaceTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="replace-pair-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-5">
            <h3 id="replace-pair-title" className="text-lg font-semibold">
              Replace{' '}
              {replaceTarget.side === 1
                ? replaceTarget.pair.player_one_name
                : replaceTarget.pair.player_two_name}
            </h3>
            <p className="text-sm text-muted-foreground">
              Completed matches retain the players who actually played. Future matches use the
              replacement.
            </p>
            <label className="block text-sm">
              Replacement player
              <SearchableMemberSelect
                value={replacementParticipantId}
                onChange={setReplacementParticipantId}
                placeholder="Choose replacement"
                options={[...activeParticipants]
                  .sort(
                    (a, b) =>
                      Number(!!replacementRestriction(a, replaceTarget)) -
                        Number(!!replacementRestriction(b, replaceTarget)) ||
                      Number(hasOpposingGenderProfile(a.gender, replaceTarget.pair.category)) -
                        Number(hasOpposingGenderProfile(b.gender, replaceTarget.pair.category)) ||
                      a.display_name.localeCompare(b.display_name),
                  )
                  .map((participant): MemberOption => {
                    const reason = replacementRestriction(participant, replaceTarget);
                    const genderLabel = profileGenderLabel(
                      participant.gender,
                      replaceTarget.pair.category,
                    );
                    const statusText =
                      [genderLabel, reason].filter(Boolean).join(' · ') || undefined;
                    return {
                      id: participant.id,
                      full_name: participant.display_name,
                      statusText,
                      sortPriority: genderLabel ? 1 : 0,
                      available: !reason,
                      unavailableReason: reason || undefined,
                    };
                  })}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReplaceTarget(null);
                  setReplacementParticipantId('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  void replacePairPlayer(replaceTarget.pair, replaceTarget.side).then((saved) => {
                    if (saved) {
                      setReplaceTarget(null);
                      setReplacementParticipantId('');
                    }
                  });
                }}
              >
                {busy ? <TennisLoader label="Replacing player" compact /> : 'Replace player'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
