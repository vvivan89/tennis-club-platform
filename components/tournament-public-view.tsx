'use client';

import { formatDateTime, formatTime } from '@/lib/time-format';
import { useTimedFeedback } from '@/hooks/use-timed-feedback';
import { evaluateTournamentScore } from '@/lib/tournament-score';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import {
  isGenderEligibleForCategory,
  knockoutStageLabel,
  knockoutRoundCount,
  type TournamentConfig,
} from '@/lib/tournament-config';
import { Input } from '@/components/ui/input';
import { EventWeather } from '@/components/event-weather';
import { Sparkles, Triangle, Trophy } from 'lucide-react';
import { TennisLoader } from '@/components/tennis-loader';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DraggableItem } from '@/components/drag-drop';
import {
  LeagueCourtAssignmentDialog,
  type LeagueCourtAssignment,
} from '@/components/league-court-assignment-dialog';
import { FloatingFeedback } from '@/components/floating-feedback';
import { PartnerSkillLevelSelect } from '@/components/partner-skill-level-select';
import {
  compareTournamentEntries,
  compareTournamentHeadToHead,
  defaultRankingPriority,
  tournamentRankingMetric,
} from '@/lib/tournament-standings';
import {
  compareByScheduleThenCourt,
  compareByScheduleThenMatchNumber,
  hasTwoPlayersPerTeam,
  roundNumbersByMatch,
  type TournamentMatchCore,
} from '@/lib/tournament-match';

type GroupOverride = {
  id: string;
  event_id: string;
  category: string;
  group_number: number;
  entry_id: string;
  override_type: 'ranking' | 'promotion';
  override_value: number;
  reason: string;
};
type Team = {
  id: string;
  name: string;
  logo_url: string | null;
  color: string;
  group_number: number | null;
  captain_user_id: string | null;
  captain_name: string | null;
};
type Participant = {
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
type PartnerMember = { id: string; full_name: string; gender: string | null };
type PairPaymentStatus = {
  pair_id: string;
  player_one_id: string;
  player_two_id: string;
  player_one_payment_status: string;
  player_two_payment_status: string;
};
type Pair = {
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
type MatchPlayer = {
  match_id: string;
  participant_id: string;
  side: number;
  team_id: string | null;
};
type Match = TournamentMatchCore & {
  event_id: string;
  team_one_name: string | null;
  team_two_name: string | null;
  player_one_name: string | null;
  player_two_name: string | null;
  opponent_one_name: string | null;
  opponent_two_name: string | null;
  notes?: string | null;
};
function safeRulesHtml(input: string) {
  if (typeof window === 'undefined')
    return input
      .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '');
  const parsed = new DOMParser().parseFromString(input, 'text/html');
  parsed
    .querySelectorAll('script,style,iframe,object,embed,form,button,input')
    .forEach((node) => node.remove());
  parsed.body.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name);
      if (
        (attribute.name === 'href' || attribute.name === 'src') &&
        /^\s*javascript:/i.test(attribute.value)
      )
        node.removeAttribute(attribute.name);
    });
  });
  return parsed.body.innerHTML;
}
const categoryLabel = (value: string) =>
  ({
    mixed: 'Mixed doubles',
    men: "Men's doubles",
    women: "Women's doubles",
    team: 'Team tournament',
  })[value] || value;
const phaseLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateLabel = (value: string | null) =>
  value ? formatDateTime(value) : 'Time to be announced';

export function TournamentPublicView({
  adminContent = null,
  eventTitle = '',
  eventDescription = '',
  genderRestriction = null,
  eventId,
  currentUserId,
  format,
  config,
  rulesHtml,
  detailsPublic,
  allowNonMemberRegistration,
  eventStatus,
  startsAt,
  endsAt,
  locationQuery,
  registrationOpensAt,
  registrationClosesAt,
  priceCents,
  interacEnabled = false,
  resultsOnly = false,
  rankingsControl,
  leagueTournament = false,
  leagueId = null,
  leagueGender = null,
  leagueStandingsBefore = [],
  leagueStandingsAfter = [],
  leagueHasResults = false,
  courtCount = 4,
}: {
  adminContent?: ReactNode;
  eventTitle?: string;
  eventDescription?: string | null;
  genderRestriction?: string | null;
  eventId: string;
  currentUserId: string | null;
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
}) {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  useEffect(() => {
    if (eventTitle) document.title = `PCTC | ${eventTitle}`;
  }, [eventTitle]);
  const hasRules = Boolean(rulesHtml?.trim()) && !leagueTournament;
  const canManageLeagueScores = leagueTournament && Boolean(adminContent);
  const [tab, setTab] = useState<
    'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit'
  >(resultsOnly ? 'competition' : 'overview');
  const [leagueStandingsMode, setLeagueStandingsMode] = useState<'before' | 'after'>('before');
  const [leagueCourtModalOpen, setLeagueCourtModalOpen] = useState(false);
  const [leagueCourtSaving, setLeagueCourtSaving] = useState(false);
  const [leagueCourtAssignments, setLeagueCourtAssignments] = useState<LeagueCourtAssignment[]>([]);
  const [leagueCourtDraft, setLeagueCourtDraft] = useState<LeagueCourtAssignment[]>([]);
  const [leagueCourtSessionCount, setLeagueCourtSessionCount] = useState(1);
  const [leagueCourtError, setLeagueCourtError] = useState('');
  const [leagueCourtConfirmation, setLeagueCourtConfirmation] = useState(false);
  const [leagueCourtView, setLeagueCourtView] = useState<'courts' | 'list'>('list');
  const [leagueScoreMatchId, setLeagueScoreMatchId] = useState('');
  const [leagueScoreTeamSide, setLeagueScoreTeamSide] = useState<'1' | '2'>('1');
  const [leagueScoreDrafts, setLeagueScoreDrafts] = useState<
    Record<string, { one: string; two: string }>
  >({});
  const [savingLeagueScore, setSavingLeagueScore] = useState<string | null>(null);
  const [leagueEventStarted, setLeagueEventStarted] = useState(
    () => Date.now() >= new Date(startsAt).getTime(),
  );
  const [leagueScoresOpen, setLeagueScoresOpen] = useState(() => {
    const elapsed = Date.now() - new Date(startsAt).getTime();
    return elapsed >= 0 && elapsed <= 2 * 24 * 60 * 60 * 1000;
  });
  useEffect(() => {
    const starts = new Date(startsAt).getTime();
    const closes = starts + 2 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    setLeagueEventStarted(now >= starts);
    const startTimer =
      now < starts
        ? window.setTimeout(
            () => {
              setLeagueEventStarted(true);
              setLeagueScoresOpen(true);
            },
            starts - now + 25,
          )
        : undefined;
    const closeTimer =
      now < closes
        ? window.setTimeout(() => setLeagueScoresOpen(false), closes - now + 25)
        : undefined;
    if (now > closes) setLeagueScoresOpen(false);
    return () => {
      if (startTimer) window.clearTimeout(startTimer);
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [startsAt]);
  const [tabInitialized, setTabInitialized] = useState(false);
  const [competitionMatchGrouping, setCompetitionMatchGrouping] = useState<'group' | 'round'>(
    'group',
  );
  useEffect(() => {
    if (resultsOnly) {
      setTab('competition');
      setTabInitialized(true);
      return;
    }
    const readTabFromUrl = () => {
      const requested = new URLSearchParams(window.location.search).get('tab');
      if (
        ['overview', 'rules', 'competition', 'participants', 'matches', 'audit'].includes(
          requested || '',
        ) &&
        !(leagueTournament && ['matches', 'audit'].includes(requested || '')) &&
        (requested !== 'rules' || hasRules)
      ) {
        setTab(
          requested as 'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit',
        );
      }
      setTabInitialized(true);
    };
    readTabFromUrl();
    window.addEventListener('popstate', readTabFromUrl);
    return () => window.removeEventListener('popstate', readTabFromUrl);
  }, [hasRules, resultsOnly, leagueTournament]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pctc-tournament-tab-change', { detail: { tab } }));
  }, [tab]);
  useEffect(() => {
    if (!tabInitialized) return;
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab, tabInitialized]);
  const [activeCategory, setActiveCategory] = useState<string>(
    (config?.categories ?? ['mixed', 'men', 'women'])[0] ?? 'mixed',
  );
  const [teams, setTeams] = useState<Team[]>([]);
  const [groupOverrides, setGroupOverrides] = useState<GroupOverride[]>([]);
  const [overrideEditor, setOverrideEditor] = useState<{
    category: string;
    group: number;
    rows: Array<{ id: string; name: string; promoted: boolean }>;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState('');
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [partnerMembers, setPartnerMembers] = useState<PartnerMember[]>([]);
  const [pairPaymentStatuses, setPairPaymentStatuses] = useState<PairPaymentStatus[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchPlayers, setMatchPlayers] = useState<MatchPlayer[]>([]);
  const [ownParticipantIds, setOwnParticipantIds] = useState<string[]>([]);
  const [ownEntries, setOwnEntries] = useState<
    Array<{
      id: string;
      team_id: string | null;
      category: string;
      payment_status: string;
      amount_cents: number;
    }>
  >([]);
  const [profileGender, setProfileGender] = useState<string | null>(null);
  const [ownCategories, setOwnCategories] = useState<string[]>([]);
  const [ownTeamIds, setOwnTeamIds] = useState<string[]>([]);
  const [ownLeagueTeamId, setOwnLeagueTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [registrationRefresh, setRegistrationRefresh] = useState(0);
  const [registrationCategory, setRegistrationCategory] = useState(
    format === 'team' ? 'team' : ((config?.categories ?? ['mixed'])[0] ?? 'mixed'),
  );
  const [registrationMode, setRegistrationMode] = useState<'individual' | 'pair'>(
    config?.registration_mode === 'doubles' ? 'pair' : 'individual',
  );
  const [partnerChoice, setPartnerChoice] = useState('');
  const [entrantName, setEntrantName] = useState('');
  const [entrantEmail, setEntrantEmail] = useState('');
  const [entrantPhone, setEntrantPhone] = useState('');
  const [entrantGender, setEntrantGender] = useState('');
  const [entrantSkillLevel, setEntrantSkillLevel] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [partnerGender, setPartnerGender] = useState('');
  const [partnerSkillLevel, setPartnerSkillLevel] = useState('');
  const {
    busy: registrationBusy,
    setBusy: setRegistrationBusy,
    error: registrationError,
    setError: setRegistrationError,
    message: registrationMessage,
    setMessage: setRegistrationMessage,
  } = useTimedFeedback();
  const [paymentParticipantIds, setPaymentParticipantIds] = useState<string[]>([]);
  const [newEntryParticipantId, setNewEntryParticipantId] = useState<string | null>(null);
  const [newPartnerParticipantId, setNewPartnerParticipantId] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentBusyKey, setPaymentBusyKey] = useState<string | null>(null);
  const [leagueWithdrawTarget, setLeagueWithdrawTarget] = useState<{
    participantId: string;
    partnerParticipantId: string;
  } | null>(null);
  const [leagueWithdrawBusy, setLeagueWithdrawBusy] = useState(false);
  const [leagueWithdrawError, setLeagueWithdrawError] = useState('');
  const [interacDetails, setInteracDetails] = useState<{
    paymentId: string;
    amountMinor: number;
    recipientEmail: string;
    instructions: string;
  } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const guestIds =
      new URLSearchParams(window.location.search)
        .get('guest_payment_ids')
        ?.split(',')
        .filter(Boolean) ?? [];
    if (
      guestIds.length === 2 &&
      guestIds.every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
      )
    ) {
      setNewEntryParticipantId(guestIds[0]);
      setNewPartnerParticipantId(guestIds[1]);
      setPaymentParticipantIds(guestIds);
    }
  }, []);
  useEffect(() => {
    let active = true;
    // Keep the results area in a loading state when the Rankings selector changes
    // the eventId. The component is reused across route changes, so this must be
    // reset for every event rather than only on initial mount.
    setLoading(true);
    // Clear the previous tournament's results immediately so they are never
    // displayed under the newly selected tournament while its data is loading.
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
          ? db
              .from('tournament_participants')
              .select('id,team_id,category,payment_status,amount_cents')
              .eq('event_id', eventId)
              .eq('user_id', currentUserId)
              .eq('status', 'registered')
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
      ]);
      const matchIds = (matchResult.data ?? []).map((m) => m.id);
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
      setOwnParticipantIds((ownResult.data ?? []).map((p: { id: string }) => p.id));
      setOwnEntries(
        (ownResult.data ?? []) as Array<{
          id: string;
          team_id: string | null;
          category: string;
          payment_status: string;
          amount_cents: number;
        }>,
      );
      const unpaidOwnEntry = (ownResult.data ?? []).find(
        (p: { payment_status?: string; amount_cents?: number }) =>
          ['pending', 'failed'].includes(p.payment_status ?? '') && Number(p.amount_cents ?? 0) > 0,
      ) as { id: string } | undefined;
      if (unpaidOwnEntry)
        setPaymentParticipantIds((current) => (current.length ? current : [unpaidOwnEntry.id]));
      setOwnCategories((ownResult.data ?? []).map((p: { category: string }) => p.category));
      setOwnTeamIds([
        ...new Set(
          (ownResult.data ?? [])
            .map((p: { team_id: string | null }) => p.team_id)
            .filter((id: string | null): id is string => !!id),
        ),
      ]);
      setOwnLeagueTeamId((leagueTeamResult.data as { id?: string } | null)?.id ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [db, eventId, currentUserId, registrationRefresh, leagueTournament, leagueId]);
  useEffect(() => {
    const channel = db
      .channel(`tournament-public-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        () => router.refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_teams',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_participants',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_pairs',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_event_court_assignments',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournament_matches',
          filter: `event_id=eq.${eventId}`,
        },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_match_players' },
        () => setRegistrationRefresh((value) => value + 1),
      )
      .subscribe();
    const syncCategory = (event: Event) => {
      const detail = (event as CustomEvent<{ category?: string }>).detail;
      if (detail?.category) setActiveCategory(detail.category);
    };
    const refreshTournamentData = (event: Event) => {
      const detail = (event as CustomEvent<{ eventId?: string }>).detail;
      if (!detail?.eventId || detail.eventId === eventId)
        setRegistrationRefresh((value) => value + 1);
    };
    window.addEventListener('pctc-tournament-category-change', syncCategory);
    window.addEventListener('pctc-tournament-data-refresh', refreshTournamentData);
    return () => {
      window.removeEventListener('pctc-tournament-category-change', syncCategory);
      window.removeEventListener('pctc-tournament-data-refresh', refreshTournamentData);
      void db.removeChannel(channel);
    };
  }, [db, eventId, router]);
  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistrationBusy(true);
    setRegistrationError('');
    setRegistrationMessage('');
    try {
      const entryCategory = leagueTournament ? leagueRegistrationCategory : registrationCategory;
      if (!currentUserId && (!entrantName.trim() || !entrantEmail.trim()))
        throw new Error('Enter your name and email to register without an account.');
      const useNewPartner =
        effectiveRegistrationMode === 'pair' && (!currentUserId || partnerChoice === 'new');
      if (currentUserId && effectiveRegistrationMode === 'pair' && !partnerChoice)
        throw new Error('Choose a registered partner or enter new partner details.');
      if (useNewPartner && (!partnerName.trim() || !partnerEmail.trim()))
        throw new Error('Enter your partner’s name and email.');
      const entrantGenderValue = currentUserId ? profileGender : entrantGender || null;
      const selectedPartner = currentUserId
        ? partnerMembers.find((member) => member.id === partnerChoice)
        : participants.find((participant) => participant.id === partnerChoice);
      const partnerGenderValue = useNewPartner
        ? partnerGender || null
        : selectedPartner?.gender ||
          ('gender_override' in (selectedPartner || {})
            ? (selectedPartner as Participant).gender_override
            : null) ||
          null;
      if (!isGenderEligibleForCategory(entryCategory, entrantGenderValue))
        throw new Error(`The entered gender is not eligible for ${categoryLabel(entryCategory)}.`);
      if (
        effectiveRegistrationMode === 'pair' &&
        partnerChoice &&
        partnerChoice !== 'new' &&
        !isGenderEligibleForCategory(entryCategory, partnerGenderValue)
      )
        throw new Error(
          `The selected partner's gender is not eligible for ${categoryLabel(entryCategory)}.`,
        );
      if (
        effectiveRegistrationMode === 'pair' &&
        useNewPartner &&
        !isGenderEligibleForCategory(entryCategory, partnerGenderValue)
      )
        throw new Error(
          `The partner's gender is not eligible for ${categoryLabel(entryCategory)}.`,
        );
      if (
        entryCategory === 'mixed' &&
        effectiveRegistrationMode === 'pair' &&
        ['male', 'female'].includes(entrantGenderValue || '') &&
        ['male', 'female'].includes(partnerGenderValue || '') &&
        entrantGenderValue === partnerGenderValue
      )
        throw new Error(
          'Mixed doubles requires one male and one female player when both genders are known.',
        );
      const { data, error: registrationError } = await db.rpc('register_tournament_entry', {
        p_event_id: eventId,
        p_category: entryCategory,
        p_display_name: entrantName.trim() || null,
        p_email: entrantEmail.trim() || null,
        p_phone: entrantPhone.trim() || null,
        p_gender: entrantGender || null,
        p_partner_participant_id: null,
        p_partner_name: useNewPartner ? partnerName.trim() : null,
        p_partner_email: useNewPartner ? partnerEmail.trim() : null,
        p_partner_phone: useNewPartner ? partnerPhone.trim() || null : null,
        p_partner_gender: useNewPartner ? partnerGender || null : null,
        p_partner_user_id:
          effectiveRegistrationMode === 'pair' &&
          currentUserId &&
          partnerChoice &&
          partnerChoice !== 'new'
            ? partnerChoice
            : null,
        p_tennis_skill_level:
          !currentUserId && entrantSkillLevel ? Number(entrantSkillLevel) : null,
        p_partner_tennis_skill_level:
          (useNewPartner || (!currentUserId && partnerChoice && partnerChoice !== 'new')) &&
          partnerSkillLevel
            ? Number(partnerSkillLevel)
            : null,
      });
      if (registrationError) throw new Error(registrationError.message);
      const result = data as {
        participantId?: string;
        amountCents?: number;
        partnerParticipantId?: string | null;
        paymentStatus?: string;
      };
      const amountDue = (result.amountCents ?? priceCents) > 0;
      setRegistrationMessage(
        amountDue && result.paymentStatus === 'paid'
          ? 'Your previous non-refunded payment was applied to this category.'
          : amountDue
            ? currentUserId
              ? 'Registration saved. Payment is pending; you can pay for your entry and your partner together.'
              : 'Provisional registration created. Complete card payment to confirm your entry.'
            : 'Registration confirmed.',
      );
      const selectedPartnerAlreadyPaid =
        !!result.partnerParticipantId &&
        participants.some(
          (participant) =>
            participant.id === result.partnerParticipantId && participant.payment_status === 'paid',
        );
      setNewEntryParticipantId(result.participantId ?? null);
      setNewPartnerParticipantId(result.partnerParticipantId ?? null);
      setPaymentParticipantIds(
        amountDue && result.participantId && result.paymentStatus !== 'paid'
          ? [
              result.participantId,
              ...(result.partnerParticipantId && !selectedPartnerAlreadyPaid
                ? [result.partnerParticipantId]
                : []),
            ]
          : [],
      );
      setPartnerChoice('');
      setEntrantName('');
      setEntrantEmail('');
      setEntrantPhone('');
      setEntrantGender('');
      setEntrantSkillLevel('');
      setPartnerName('');
      setPartnerEmail('');
      setPartnerPhone('');
      setPartnerGender('');
      setPartnerSkillLevel('');
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not register for this tournament.',
      );
    } finally {
      setRegistrationBusy(false);
    }
  }
  async function registerLeagueTeam() {
    if (!ownLeagueTeamId || !currentUserId) return;
    setRegistrationBusy(true);
    setRegistrationError('');
    setRegistrationMessage('');
    try {
      const { data, error } = await db.rpc('register_league_event_team', {
        p_event_id: eventId,
        p_member_id: currentUserId,
      });
      if (error) throw new Error(error.message);
      const result = data as {
        participantId?: string;
        partnerParticipantId?: string;
        amountCents?: number;
        paymentStatus?: string;
      };
      const amountDue = (result.amountCents ?? priceCents) > 0;
      setRegistrationMessage(
        amountDue
          ? 'Your team is registered. Payment is pending; you can pay for both players together.'
          : 'Your team is registered.',
      );
      setNewEntryParticipantId(result.participantId ?? null);
      setNewPartnerParticipantId(result.partnerParticipantId ?? null);
      setPaymentParticipantIds(
        amountDue && result.participantId && result.partnerParticipantId
          ? [result.participantId, result.partnerParticipantId]
          : [],
      );
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not register your League team.',
      );
    } finally {
      setRegistrationBusy(false);
    }
  }
  async function registerLeagueSingle() {
    if (!currentUserId) return;
    setRegistrationBusy(true);
    setRegistrationError('');
    setRegistrationMessage('');
    try {
      const { data, error } = await db.rpc('register_league_single_event_entry', {
        p_event_id: eventId,
      });
      if (error) throw new Error(error.message);
      const result = data as { participantId?: string; amountCents?: number };
      const amountDue = (result.amountCents ?? priceCents) > 0;
      setRegistrationMessage(
        amountDue
          ? 'You are registered as a single player. Payment is pending.'
          : 'You are registered as a single player. An organizer can pair you with a League team.',
      );
      setNewEntryParticipantId(result.participantId ?? null);
      setPaymentParticipantIds(amountDue && result.participantId ? [result.participantId] : []);
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not register for this League event.',
      );
    } finally {
      setRegistrationBusy(false);
    }
  }
  async function confirmLeagueTeamWithdrawal() {
    if (!leagueWithdrawTarget) return;
    setLeagueWithdrawBusy(true);
    setLeagueWithdrawError('');
    try {
      const paymentResponse = await fetch('/api/payments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantIds: [
            leagueWithdrawTarget.participantId,
            leagueWithdrawTarget.partnerParticipantId,
          ],
        }),
      });
      const paymentResult = await paymentResponse.json().catch(() => ({}));
      if (!paymentResponse.ok)
        throw new Error(paymentResult.error || 'Could not safely cancel the pending team payment.');
      const { error } = await db.rpc('withdraw_league_event_team', {
        p_participant_id: leagueWithdrawTarget.participantId,
      });
      if (error) throw new Error(error.message);
      setLeagueWithdrawTarget(null);
      setRegistrationMessage('You and your League partner have been withdrawn from this event.');
      setRegistrationRefresh((value) => value + 1);
    } catch (error) {
      setLeagueWithdrawError(
        error instanceof Error ? error.message : 'Could not withdraw your League team.',
      );
    } finally {
      setLeagueWithdrawBusy(false);
    }
  }
  function tournamentPaymentActionKey(
    participantIds: string[],
    provider: 'stripe' | 'interac' = 'stripe',
  ) {
    return `${provider}:${[...new Set(participantIds)].sort().join(',')}`;
  }

  async function startTournamentPayment(
    participantIds = paymentParticipantIds,
    provider: 'stripe' | 'interac' = 'stripe',
  ) {
    if (!participantIds.length) return;
    setPaymentBusy(true);
    setPaymentBusyKey(tournamentPaymentActionKey(participantIds, provider));
    setRegistrationError('');
    try {
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'tournament_registration',
          provider,
          businessRecordId: [...new Set(participantIds)].sort().join(','),
          returnTo:
            !currentUserId &&
            newEntryParticipantId &&
            newPartnerParticipantId &&
            participantIds.length === 1
              ? `${window.location.pathname}?guest_payment_ids=${encodeURIComponent([newEntryParticipantId, newPartnerParticipantId].join(','))}`
              : `/events/${eventId}`,
          returnLabel: 'Back to tournament',
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not start tournament payment.');
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (provider === 'interac' && result.message) {
        setInteracDetails({
          paymentId: result.paymentId,
          amountMinor: result.amountMinor,
          recipientEmail: result.recipientEmail,
          instructions: result.instructions || '',
        });
        setRegistrationMessage(result.message);
        return;
      }
      throw new Error(
        result.message ||
          'Payment instructions were not returned. Contact the tournament organizer.',
      );
    } catch (error) {
      setRegistrationError(
        error instanceof Error ? error.message : 'Could not start tournament payment.',
      );
    } finally {
      setPaymentBusy(false);
      setPaymentBusyKey(null);
    }
  }

  async function saveCaptainPairing(match: Match, teamId: string, side: 1 | 2) {
    const first =
      (document.getElementById(`captain-pair-${match.id}-${side}-a`) as HTMLSelectElement | null)
        ?.value || '';
    const second =
      (document.getElementById(`captain-pair-${match.id}-${side}-b`) as HTMLSelectElement | null)
        ?.value || '';
    if (!first || !second || first === second) {
      window.alert('Select two different players for the doubles pairing.');
      return;
    }
    const { error: deleteError } = await db
      .from('tournament_match_players')
      .delete()
      .eq('match_id', match.id)
      .eq('team_id', teamId);
    if (deleteError) {
      window.alert(deleteError.message);
      return;
    }
    const { error: insertError } = await db.from('tournament_match_players').insert([
      { match_id: match.id, participant_id: first, side, team_id: teamId },
      { match_id: match.id, participant_id: second, side, team_id: teamId },
    ]);
    if (insertError) {
      window.alert(insertError.message);
      return;
    }
    setMatchPlayers((current) => [
      ...current.filter((p) => !(p.match_id === match.id && p.team_id === teamId)),
      { match_id: match.id, participant_id: first, side, team_id: teamId },
      { match_id: match.id, participant_id: second, side, team_id: teamId },
    ]);
  }
  async function saveCaptainScore(match: Match) {
    if (!hasTwoPlayersPerTeam(match, matchPlayers)) {
      window.alert(
        'Assign two players to each team before recording the result so individual records remain accurate.',
      );
      return;
    }
    const input = document.getElementById(`captain-score-${match.id}`) as HTMLInputElement | null;
    const raw = input?.value ?? '';
    const evaluation = evaluateTournamentScore(raw, config?.scoring_template);
    if (evaluation.error !== undefined) {
      window.alert(evaluation.error);
      return;
    }
    const { sets, winner, pointsOne, pointsTwo } = evaluation;
    const { error: saveError } = await db
      .from('tournament_matches')
      .update({
        score_sets: sets,
        winner_side: winner,
        status: 'completed',
        team_points_one: pointsOne,
        team_points_two: pointsTwo,
        entered_by: currentUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', match.id);
    if (saveError) {
      window.alert(saveError.message);
      return;
    }
    setMatches((current) =>
      current.map((item) =>
        item.id === match.id
          ? {
              ...item,
              score_sets: sets,
              winner_side: winner,
              status: 'completed',
              team_points_one: pointsOne,
              team_points_two: pointsTwo,
            }
          : item,
      ),
    );
  }
  const ownNextMatch = useMemo(
    () =>
      matches
        .filter(
          (m) =>
            m.status === 'scheduled' &&
            (format === 'team' || m.category === activeCategory) &&
            m.scheduled_at &&
            new Date(m.scheduled_at).getTime() >= Date.now() &&
            (ownTeamIds.includes(m.team_one_id || '') ||
              ownTeamIds.includes(m.team_two_id || '') ||
              pairs.some(
                (p) =>
                  p.status !== 'withdrawn' &&
                  p.category === m.category &&
                  (p.id === m.pair_one_id || p.id === m.pair_two_id) &&
                  (ownParticipantIds.includes(p.player_one_id) ||
                    ownParticipantIds.includes(p.player_two_id)),
              )),
        )
        .sort(
          (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
        )[0],
    [matches, ownTeamIds, ownParticipantIds, pairs, activeCategory, format],
  );
  const enabledPhases = config?.phases ?? {
    round_robin: true,
    preliminary_knockout: false,
    final_knockout: true,
    team_round_robin: true,
    team_knockout: true,
  };
  const visibleMatches = matches.filter(
    (m) =>
      m.status !== 'cancelled' &&
      (m.phase === 'round_robin'
        ? enabledPhases.round_robin !== false
        : m.phase === 'preliminary_knockout'
          ? enabledPhases.preliminary_knockout === true
          : m.phase === 'final_knockout'
            ? enabledPhases.final_knockout !== false
            : m.phase === 'team_round_robin'
              ? enabledPhases.team_round_robin !== false
              : m.phase === 'team_knockout'
                ? enabledPhases.team_knockout !== false
                : false),
  );
  const categoryVisibleMatches = visibleMatches.filter(
    (match) => format === 'team' || match.category === activeCategory,
  );
  const roundRobinRoundByMatch = useMemo(
    () =>
      roundNumbersByMatch(
        categoryVisibleMatches
          .filter(
            (match) =>
              match.phase.includes('round_robin') &&
              match.status !== 'cancelled' &&
              match.status !== 'bye',
          )
          .sort(compareByScheduleThenMatchNumber),
        format === 'team',
      ),
    [categoryVisibleMatches, format],
  );
  const isOwnPair = (pairId: string | null | undefined) => {
    if (!pairId || !currentUserId) return false;
    const pair = pairs.find((item) => item.id === pairId);
    return (
      !!pair &&
      (ownParticipantIds.includes(pair.player_one_id) ||
        ownParticipantIds.includes(pair.player_two_id))
    );
  };
  async function saveLeagueScore(match: Match) {
    if (Date.now() < new Date(startsAt).getTime()) {
      window.alert('Scores cannot be entered before the event start time.');
      return;
    }
    if (
      !canManageLeagueScores &&
      Date.now() - new Date(startsAt).getTime() > 2 * 24 * 60 * 60 * 1000
    ) {
      window.alert('Scores can only be entered within two days of the event.');
      return;
    }
    const draft = leagueScoreDrafts[match.id] ?? { one: '', two: '' };
    const ownOnOne = canManageLeagueScores
      ? leagueScoreTeamSide === '1'
      : isOwnPair(match.pair_one_id);
    const existingOne = match.score_sets?.[0]?.[ownOnOne ? 'one' : 'two'];
    const existingTwo = match.score_sets?.[0]?.[ownOnOne ? 'two' : 'one'];
    const enteredOwnScore = Number(draft.one || (match.status === 'completed' ? existingOne : ''));
    const enteredOpponentScore = Number(
      draft.two || (match.status === 'completed' ? existingTwo : ''),
    );
    const one = ownOnOne ? enteredOwnScore : enteredOpponentScore;
    const two = ownOnOne ? enteredOpponentScore : enteredOwnScore;
    if (!Number.isInteger(one) || !Number.isInteger(two) || one < 0 || two < 0 || one === two) {
      window.alert('Enter two different non-negative scores.');
      return;
    }
    setSavingLeagueScore(match.id);
    const { error } = await db.rpc('submit_league_match_score', {
      p_match_id: match.id,
      p_score_one: one,
      p_score_two: two,
    });
    setSavingLeagueScore(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    setMatches((current) =>
      current.map((item) =>
        item.id === match.id
          ? {
              ...item,
              score_sets: [{ one, two }],
              winner_side: one > two ? 1 : 2,
              status: 'completed',
            }
          : item,
      ),
    );
    setLeagueScoreDrafts((current) => ({ ...current, [match.id]: { one: '', two: '' } }));
    router.refresh();
  }
  const isOwnCompetitionEntry = (entryId: string) =>
    format === 'team' ? ownTeamIds.includes(entryId) : isOwnPair(entryId);
  const knockoutMatches = categoryVisibleMatches
    .filter((match) => match.phase.includes('knockout'))
    .sort((a, b) => a.round_number - b.round_number || a.match_number - b.match_number);
  const bracketStageLabel = (_phase: string, round: number, maxRound: number) =>
    knockoutStageLabel(round, Math.max(1, maxRound));
  const bracketSideLabel = (match: Match, side: 1 | 2, maxRound: number) => {
    const id =
      format === 'team'
        ? side === 1
          ? match.team_one_id
          : match.team_two_id
        : side === 1
          ? match.pair_one_id
          : match.pair_two_id;
    if (id) {
      if (format === 'team')
        return (
          teams.find((team) => team.id === id)?.name ||
          (side === 1 ? match.team_one_name : match.team_two_name) ||
          'TBD'
        );
      const pair = pairs.find((item) => item.id === id);
      return pair
        ? `${pair.player_one_name} + ${pair.player_two_name}`
        : (side === 1 ? match.player_one_name : match.opponent_one_name) || 'TBD';
    }
    // Generated knockout draws can contain unresolved group-place slots with no
    // pair/team ID yet. Read the saved slot label before applying the match-level
    // BYE status, otherwise both sides of a BYE match are rendered as BYE.
    let savedSlotLabel: string | null = null;
    try {
      const notes = JSON.parse(match.notes || '{}') as {
        slot_one?: string | null;
        slot_two?: string | null;
      };
      savedSlotLabel = side === 1 ? (notes.slot_one ?? null) : (notes.slot_two ?? null);
    } catch {
      // Older matches may have free-form notes rather than slot metadata.
    }
    if (savedSlotLabel?.toLowerCase() === 'bye') return 'BYE';
    if (savedSlotLabel && /^Group \d+ Team \d+$/.test(savedSlotLabel)) return savedSlotLabel;
    if (match.status === 'bye' && match.winner_side && side !== match.winner_side) return 'BYE';
    if (match.status === 'bye' && !match.winner_side) return 'TBD';
    if (match.round_number > 1) {
      const previousRound = match.round_number - 1;
      const previousMatchNumber = (match.match_number - 1) * 2 + side;
      const previousLabel = bracketStageLabel(match.phase, previousRound, maxRound);
      const previous = knockoutMatches.find(
        (item) =>
          item.phase === match.phase &&
          item.round_number === previousRound &&
          item.match_number === previousMatchNumber,
      );
      if (previous?.winner_side) {
        const previousId =
          format === 'team'
            ? previous.winner_side === 1
              ? previous.team_one_id
              : previous.team_two_id
            : previous.winner_side === 1
              ? previous.pair_one_id
              : previous.pair_two_id;
        if (previousId)
          return format === 'team'
            ? teams.find((team) => team.id === previousId)?.name ||
                `Winner of ${previousLabel} ${previousMatchNumber}`
            : (() => {
                const pair = pairs.find((item) => item.id === previousId);
                return pair
                  ? `${pair.player_one_name} + ${pair.player_two_name}`
                  : `Winner of ${previousLabel} ${previousMatchNumber}`;
              })();
      }
      return `Winner of ${previousLabel} ${previousMatchNumber}`;
    }
    try {
      const note = JSON.parse(match.notes || '{}') as {
        slot_one?: string | null;
        slot_two?: string | null;
      };
      return (side === 1 ? note.slot_one : note.slot_two) || 'TBD';
    } catch {
      return 'TBD';
    }
  };
  const canViewCompetition = detailsPublic || (!!currentUserId && ownParticipantIds.length > 0);
  const leagueRegistrationCategory = leagueGender === 'male' ? 'men' : 'women';
  const registrationGender = currentUserId ? profileGender : entrantGender || null;
  const enabledDoublesCategories = (config?.categories ?? ['mixed', 'men', 'women']).filter(
    (category: string) => ['mixed', 'men', 'women'].includes(category),
  );
  const hasGenderEligibleCategory =
    format === 'team' ||
    enabledDoublesCategories.some((category: string) =>
      isGenderEligibleForCategory(category, registrationGender),
    );
  const availableCategories = (
    leagueTournament
      ? ownCategories.includes(leagueRegistrationCategory) ||
        !isGenderEligibleForCategory(leagueRegistrationCategory, registrationGender)
        ? []
        : [leagueRegistrationCategory]
      : format === 'team'
        ? ['team']
        : (config?.categories ?? ['mixed', 'men', 'women']).filter(
            (category: string) =>
              !ownCategories.includes(category) &&
              !(category === 'men' && ownCategories.includes('women')) &&
              !(category === 'women' && ownCategories.includes('men')) &&
              !(
                category === 'men' &&
                registrationGender !== null &&
                registrationGender !== 'male'
              ) &&
              !(
                category === 'women' &&
                registrationGender !== null &&
                registrationGender !== 'female'
              ) &&
              !(
                category === 'mixed' &&
                registrationGender !== null &&
                !['male', 'female'].includes(registrationGender)
              ),
          )
  ).filter(() => !currentUserId || ownCategories.length < (format === 'team' ? 1 : 2));
  const registrationOpen =
    eventStatus === 'published' &&
    Date.now() >= new Date(registrationOpensAt).getTime() &&
    Date.now() < new Date(registrationClosesAt || startsAt).getTime();
  const registrationModeConfig = config?.registration_mode ?? 'both';
  const effectiveRegistrationMode =
    leagueTournament || registrationModeConfig === 'single'
      ? 'individual'
      : registrationModeConfig === 'doubles'
        ? 'pair'
        : registrationMode;
  const firstAvailableCategory = availableCategories[0];
  const registrationCategoryIsAvailable = availableCategories.includes(registrationCategory);
  useEffect(() => {
    if (firstAvailableCategory && !registrationCategoryIsAvailable)
      setRegistrationCategory(firstAvailableCategory);
  }, [firstAvailableCategory, registrationCategoryIsAvailable]);
  const groupStandings = useMemo(() => {
    const groups = new Map<
      string,
      {
        category: string;
        group: number;
        rows: Map<
          string,
          {
            id: string;
            name: string;
            played: number;
            wins: number;
            points: number;
            setsFor: number;
            setsAgainst: number;
            gamesFor: number;
            gamesAgainst: number;
          }
        >;
      }
    >();
    const ensureGroup = (category: string, group: number) => {
      const key = `${category}:${group}`;
      if (!groups.has(key)) groups.set(key, { category, group, rows: new Map() });
      return groups.get(key)!;
    };
    const ensureEntry = (category: string, group: number, id: string, name: string) => {
      const g = ensureGroup(category, group);
      if (!g.rows.has(id))
        g.rows.set(id, {
          id,
          name,
          played: 0,
          wins: 0,
          points: 0,
          setsFor: 0,
          setsAgainst: 0,
          gamesFor: 0,
          gamesAgainst: 0,
        });
      return g.rows.get(id)!;
    };
    if (format === 'team')
      teams
        .filter((team) => team.group_number)
        .forEach((team) => ensureEntry('team', team.group_number!, team.id, team.name));
    else
      pairs
        .filter((pair) => pair.group_number && pair.status !== 'withdrawn')
        .forEach((pair) =>
          ensureEntry(
            pair.category,
            pair.group_number!,
            pair.id,
            `${pair.player_one_name} + ${pair.player_two_name}`,
          ),
        );
    visibleMatches
      .filter((m) => m.group_number && m.status === 'completed' && m.phase.includes('round_robin'))
      .forEach((m) => {
        const firstId = format === 'team' ? m.team_one_id : m.pair_one_id;
        const secondId = format === 'team' ? m.team_two_id : m.pair_two_id;
        const firstName = format === 'team' ? m.team_one_name : m.player_one_name || 'TBD';
        const secondName = format === 'team' ? m.team_two_name : m.opponent_one_name || 'TBD';
        if (!firstId || !secondId) return;
        const one = ensureEntry(m.category, m.group_number!, firstId, firstName || 'TBD');
        const two = ensureEntry(m.category, m.group_number!, secondId, secondName || 'TBD');
        one.played++;
        two.played++;
        if (m.winner_side === 1) one.wins++;
        if (m.winner_side === 2) two.wins++;
        one.points += m.team_points_one;
        two.points += m.team_points_two;
        for (const set of m.score_sets ?? []) {
          one.setsFor += set.one > set.two ? 1 : 0;
          one.setsAgainst += set.two > set.one ? 1 : 0;
          two.setsFor += set.two > set.one ? 1 : 0;
          two.setsAgainst += set.one > set.two ? 1 : 0;
          one.gamesFor += set.one;
          one.gamesAgainst += set.two;
          two.gamesFor += set.two;
          two.gamesAgainst += set.one;
        }
      });
    const priority = config?.ranking_priority ?? defaultRankingPriority(format === 'team');
    const value = tournamentRankingMetric;
    return [...groups.values()]
      .sort((a, b) => a.group - b.group || a.category.localeCompare(b.category))
      .map((group) => {
        const standings = [...group.rows.values()].sort((a, b) =>
          compareTournamentEntries(
            a,
            b,
            priority,
            value,
            (first, second) =>
              compareTournamentHeadToHead(
                visibleMatches,
                first.id,
                second.id,
                format === 'team',
                (match) =>
                  match.category === group.category &&
                  match.group_number === group.group &&
                  match.status === 'completed',
              ),
            (row) => row.name,
          ),
        );
        const automaticPositions = new Map(standings.map((row, index) => [row.id, index + 1]));
        const overrides = groupOverrides
          .filter(
            (item) =>
              item.category === group.category &&
              item.group_number === group.group &&
              item.override_type === 'ranking',
          )
          .sort((a, b) => a.override_value - b.override_value);
        for (const override of overrides) {
          const currentIndex = standings.findIndex((row) => row.id === override.entry_id);
          if (currentIndex < 0) continue;
          const [row] = standings.splice(currentIndex, 1);
          standings.splice(
            Math.max(0, Math.min(standings.length, override.override_value - 1)),
            0,
            row,
          );
        }
        return {
          ...group,
          standings: standings.map((row) => ({
            ...row,
            automaticPosition: automaticPositions.get(row.id) ?? 0,
          })),
        };
      });
  }, [visibleMatches, teams, pairs, config, format, groupOverrides]);
  function openGroupOverrideEditor(group: (typeof groupStandings)[number]) {
    const promotionEnabled =
      format === 'team'
        ? enabledPhases.team_round_robin !== false && enabledPhases.team_knockout !== false
        : enabledPhases.round_robin !== false && enabledPhases.final_knockout !== false;
    setOverrideEditor({
      category: group.category,
      group: group.group,
      rows: group.standings.map((row, index) => {
        const promotionOverride = groupOverrides.find(
          (item) =>
            item.category === group.category &&
            item.group_number === group.group &&
            item.entry_id === row.id &&
            item.override_type === 'promotion',
        );
        const automaticallyPromoted =
          group.standings.some((standing) => standing.played > 0) &&
          promotionEnabled &&
          index < Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
        return {
          id: row.id,
          name: row.name,
          promoted: promotionOverride
            ? promotionOverride.override_value === 1
            : automaticallyPromoted,
        };
      }),
    });
    setOverrideReason('');
    setOverrideError('');
  }

  function moveOverrideRow(entryId: string, targetId: string) {
    setOverrideEditor((current) => {
      if (!current || entryId === targetId) return current;
      const rows = [...current.rows];
      const from = rows.findIndex((row) => row.id === entryId);
      const to = rows.findIndex((row) => row.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      return { ...current, rows };
    });
  }

  async function saveGroupOverridesFromEditor() {
    if (!overrideEditor) return;
    const reason = overrideReason.trim();
    if (!reason) {
      setOverrideError('Enter a reason for the group changes.');
      return;
    }
    setOverrideSaving(true);
    setOverrideError('');
    try {
      const existingForGroup = groupOverrides.filter(
        (item) =>
          item.category === overrideEditor.category && item.group_number === overrideEditor.group,
      );
      const originalOrder =
        groupStandings
          .find(
            (group) =>
              group.category === overrideEditor.category && group.group === overrideEditor.group,
          )
          ?.standings.map((row) => row.id) ?? [];
      const orderChanged = originalOrder.some((id, index) => overrideEditor.rows[index]?.id !== id);
      const writes = [] as Array<{
        event_id: string;
        category: string;
        group_number: number;
        entry_id: string;
        override_type: 'ranking' | 'promotion';
        override_value: number;
        reason: string;
        updated_at: string;
      }>;
      const now = new Date().toISOString();
      if (orderChanged) {
        overrideEditor.rows.forEach((row, index) =>
          writes.push({
            event_id: eventId,
            category: overrideEditor.category,
            group_number: overrideEditor.group,
            entry_id: row.id,
            override_type: 'ranking',
            override_value: index + 1,
            reason,
            updated_at: now,
          }),
        );
      }
      for (const row of overrideEditor.rows) {
        const previous = existingForGroup.find(
          (item) => item.entry_id === row.id && item.override_type === 'promotion',
        );
        const previousStatus = previous
          ? previous.override_value === 1
          : (() => {
              const index =
                groupStandings
                  .find(
                    (group) =>
                      group.category === overrideEditor.category &&
                      group.group === overrideEditor.group,
                  )
                  ?.standings.findIndex((standing) => standing.id === row.id) ?? -1;
              const promotionEnabled =
                format === 'team'
                  ? enabledPhases.team_round_robin !== false &&
                    enabledPhases.team_knockout !== false
                  : enabledPhases.round_robin !== false && enabledPhases.final_knockout !== false;
              const standings =
                groupStandings.find(
                  (group) =>
                    group.category === overrideEditor.category &&
                    group.group === overrideEditor.group,
                )?.standings ?? [];
              return (
                standings.some((standing) => standing.played > 0) &&
                promotionEnabled &&
                index >= 0 &&
                index < Math.max(1, Number(config?.promoted_teams_per_group ?? 2))
              );
            })();
        if (row.promoted !== previousStatus)
          writes.push({
            event_id: eventId,
            category: overrideEditor.category,
            group_number: overrideEditor.group,
            entry_id: row.id,
            override_type: 'promotion',
            override_value: row.promoted ? 1 : 0,
            reason,
            updated_at: now,
          });
      }
      if (writes.length) {
        const { error } = await db
          .from('tournament_group_overrides')
          .upsert(writes, { onConflict: 'event_id,category,group_number,entry_id,override_type' });
        if (error) throw error;
      }
      const { data, error } = await db
        .from('tournament_group_overrides')
        .select('*')
        .eq('event_id', eventId);
      if (error) throw error;
      setGroupOverrides((data ?? []) as GroupOverride[]);
      setOverrideEditor(null);
      setOverrideReason('');
    } catch (error) {
      setOverrideError(error instanceof Error ? error.message : 'Could not save group standings.');
    } finally {
      setOverrideSaving(false);
    }
  }

  const winnerSummaries = useMemo(() => {
    const categories =
      format === 'team' ? ['team'] : (config?.categories ?? ['mixed', 'men', 'women']);
    const summaries: Array<{ category: string; winners: string[] }> = [];
    const rankingPriority = config?.ranking_priority ?? defaultRankingPriority(format === 'team');
    const metric = tournamentRankingMetric;
    for (const category of categories) {
      const phase = format === 'team' ? 'team_knockout' : 'final_knockout';
      const knockoutEnabled = config?.phases?.[phase] !== false;
      const categoryMatches = matches.filter(
        (match) => match.category === category && match.status !== 'cancelled',
      );
      if (knockoutEnabled) {
        const finals = categoryMatches.filter((match) => match.phase === phase);
        if (!finals.length) continue;
        const roundRobinPhase = format === 'team' ? 'team_round_robin' : 'round_robin';
        const roundRobinEnabled = config?.phases?.[roundRobinPhase] !== false;
        const categoryEntries =
          format === 'team'
            ? teams
            : pairs.filter((pair) => pair.category === category && pair.status !== 'withdrawn');
        const entrantCount = roundRobinEnabled
          ? new Set(
              categoryEntries.map((entry) => entry.group_number).filter((group) => group != null),
            ).size * Math.max(1, Number(config?.promoted_teams_per_group ?? 2))
          : categoryEntries.length;
        const expectedFinalRound = knockoutRoundCount(entrantCount);
        const finalMatch = finals.find((match) => match.round_number === expectedFinalRound);
        if (
          !expectedFinalRound ||
          !finalMatch ||
          finalMatch.status !== 'completed' ||
          !finalMatch.winner_side
        )
          continue;
        const winnerId =
          format === 'team'
            ? finalMatch.winner_side === 1
              ? finalMatch.team_one_id
              : finalMatch.team_two_id
            : finalMatch.winner_side === 1
              ? finalMatch.pair_one_id
              : finalMatch.pair_two_id;
        const winner =
          format === 'team'
            ? teams.find((team) => team.id === winnerId)?.name
            : (() => {
                const pair = pairs.find((item) => item.id === winnerId);
                return pair ? `${pair.player_one_name} + ${pair.player_two_name}` : undefined;
              })();
        if (winner) summaries.push({ category, winners: [winner] });
        continue;
      }
      const roundRobinPhase = format === 'team' ? 'team_round_robin' : 'round_robin';
      const scheduled = categoryMatches.filter((match) => match.phase === roundRobinPhase);
      if (
        !scheduled.length ||
        scheduled.some((match) => match.status !== 'completed' || !match.score_sets?.length)
      )
        continue;
      const rows = groupStandings
        .filter((group) => group.category === category)
        .flatMap((group) => group.standings.map((row) => ({ ...row, group: group.group })));
      if (!rows.length) continue;
      const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
        for (const key of rankingPriority) {
          if (key === 'head_to_head') {
            if (a.group !== b.group) continue;
            const direct = categoryMatches.find(
              (match) =>
                match.phase === roundRobinPhase &&
                match.group_number === a.group &&
                match.status === 'completed' &&
                ((format === 'team' && match.team_one_id === a.id && match.team_two_id === b.id) ||
                  (format === 'team' && match.team_one_id === b.id && match.team_two_id === a.id) ||
                  (format !== 'team' && match.pair_one_id === a.id && match.pair_two_id === b.id) ||
                  (format !== 'team' && match.pair_one_id === b.id && match.pair_two_id === a.id)),
            );
            if (direct?.winner_side) {
              const firstId = format === 'team' ? direct.team_one_id : direct.pair_one_id;
              const aWon = firstId === a.id ? direct.winner_side === 1 : direct.winner_side === 2;
              return aWon ? -1 : 1;
            }
            continue;
          }
          const difference = metric(b, key) - metric(a, key);
          if (difference) return difference;
        }
        return 0;
      };
      const sorted = [...rows].sort(compare);
      const winners = sorted.filter((row) => compare(row, sorted[0]) === 0).map((row) => row.name);
      if (winners.length) summaries.push({ category, winners });
    }
    return summaries;
  }, [matches, teams, pairs, config, format, groupStandings]);
  const rankingColumns = (
    config?.ranking_priority ??
    (format === 'team'
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
        ])
  ).filter((key) =>
    [
      'points',
      'matches_won',
      'sets_won',
      'games_won',
      'set_difference',
      'game_difference',
    ].includes(key),
  );
  const rankingColumnLabel: Record<string, string> = {
    points: 'Points',
    matches_won: 'Won',
    sets_won: 'Sets won',
    games_won: 'Games won',
    set_difference: 'Set diff.',
    game_difference: 'Game diff.',
  };
  const activeLeaguePairs = pairs.filter(
    (pair) => pair.category === activeCategory && pair.status !== 'withdrawn',
  );
  const unpairedLeagueParticipants = participants.filter(
    (participant) =>
      participant.category === activeCategory &&
      participant.status === 'registered' &&
      !activeLeaguePairs.some(
        (pair) => pair.player_one_id === participant.id || pair.player_two_id === participant.id,
      ),
  );
  const leagueScheduledMatches = matches.filter((match) => match.court_number);
  const leagueTimeSlots = Array.from(
    new Set(leagueScheduledMatches.map((match) => match.scheduled_at || 'unscheduled')),
  ).sort((a, b) => {
    if (a === 'unscheduled') return 1;
    if (b === 'unscheduled') return -1;
    return a.localeCompare(b);
  });
  const leaguePairs = pairs.filter((pair) => pair.status !== 'withdrawn');
  const courtTotal = Math.min(4, Math.max(1, courtCount));
  const leagueCourtCounts = leagueCourtDraft.reduce((counts, assignment) => {
    const key = `${assignment.segment_order}:${assignment.court_number}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const leagueCourtWarnings = [...leagueCourtCounts.entries()]
    .filter(([, count]) => count > 2)
    .map(([key, count]) => {
      const [session, court] = key.split(':').map(Number);
      return { session, court, count };
    });
  function openLeagueCourtModal() {
    setLeagueCourtDraft(leagueCourtAssignments.map((assignment) => ({ ...assignment })));
    setLeagueCourtSessionCount(
      Math.max(1, ...leagueCourtAssignments.map((assignment) => assignment.segment_order)),
    );
    setLeagueCourtError('');
    setLeagueCourtModalOpen(true);
  }
  function moveLeaguePairToCourt(pairId: string, court: number, session: number) {
    setLeagueCourtDraft((current) => {
      const retained = current.filter(
        (assignment) => assignment.pair_id !== pairId || assignment.segment_order !== session,
      );
      return [...retained, { pair_id: pairId, court_number: court, segment_order: session }];
    });
    setLeagueCourtError('');
  }
  function unassignLeaguePair(pairId: string, session: number) {
    setLeagueCourtDraft((current) =>
      current.filter(
        (assignment) => assignment.pair_id !== pairId || assignment.segment_order !== session,
      ),
    );
  }
  async function saveLeagueCourtAssignments(skipWarnings = false) {
    const incomplete = Array.from(
      { length: leagueCourtSessionCount },
      (_, index) => index + 1,
    ).some((session) =>
      leaguePairs.some(
        (pair) =>
          leagueCourtDraft.filter(
            (assignment) => assignment.pair_id === pair.id && assignment.segment_order === session,
          ).length !== 1,
      ),
    );
    if (incomplete) {
      setLeagueCourtError('Assign every League team once in each sub-session.');
      return;
    }
    if (leagueCourtWarnings.length && !skipWarnings) {
      setLeagueCourtConfirmation(true);
      return;
    }
    setLeagueCourtSaving(true);
    setLeagueCourtError('');
    const { error } = await db.rpc('save_league_event_court_assignments', {
      p_event_id: eventId,
      p_assignments: leagueCourtDraft,
    });
    if (error) {
      setLeagueCourtError(error.message);
      setLeagueCourtSaving(false);
      return;
    }
    setLeagueCourtAssignments(leagueCourtDraft);
    setRegistrationRefresh((value) => value + 1);
    setLeagueCourtModalOpen(false);
    setLeagueCourtSaving(false);
    router.refresh();
  }
  return (
    <section className={leagueTournament ? 'space-y-8' : 'space-y-5'}>
      <FloatingFeedback error={registrationError} message={registrationMessage} />
      {(canViewCompetition || !!adminContent) && (
        <>
          {!resultsOnly && winnerSummaries.length > 0 && (
            <section aria-label="Tournament winners">
              <div className="grid auto-cols-max grid-flow-col gap-4 overflow-x-auto pb-2">
                {winnerSummaries.map((summary) => (
                  <div
                    key={summary.category}
                    className="min-w-52 rounded-xl border border-amber-300/80 bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-100 p-4 text-center shadow-md ring-1 ring-amber-200/60 dark:border-amber-800 dark:from-amber-950/70 dark:via-yellow-950/45 dark:to-orange-950/70 dark:ring-amber-900/70"
                  >
                    <div
                      className="mb-3 flex items-center justify-center gap-2 text-amber-600"
                      aria-hidden="true"
                    >
                      <Sparkles className="h-4 w-4" />
                      <Trophy className="h-7 w-7 drop-shadow-sm" />
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {summary.category === 'men'
                        ? "Men's Doubles Winners"
                        : summary.category === 'women'
                          ? "Women's Doubles Winners"
                          : summary.category === 'mixed'
                            ? 'Mixed Doubles Winners'
                            : 'Team Tournament Winners'}
                    </p>
                    <p className="mt-2 font-semibold">{summary.winners.join(' / ')}</p>
                    {summary.winners.length > 1 && (
                      <span className="mt-1 inline-block text-xs font-medium text-amber-700 dark:text-amber-400">
                        Tie
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          {(!resultsOnly || rankingsControl) && (
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              {!resultsOnly && (
                <div
                  className="flex flex-wrap gap-2"
                  role="tablist"
                  aria-label="Tournament details"
                >
                  {(
                    [
                      ['overview', 'Overview'],
                      ...(hasRules ? ([['rules', 'Rules']] as Array<[typeof tab, string]>) : []),
                      [
                        'competition',
                        leagueTournament ? 'Schedule & Results' : 'Groups, Schedule & Results',
                      ],
                      ...(adminContent
                        ? [
                            ['participants', 'Participants'],
                            ...(!leagueTournament
                              ? ([['matches', 'Matches']] as Array<[typeof tab, string]>)
                              : []),
                            ...(!leagueTournament
                              ? ([['audit', 'Audit log']] as Array<[typeof tab, string]>)
                              : []),
                          ]
                        : []),
                    ] as Array<[typeof tab, string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => {
                        setTab(key);
                        if (['participants', 'matches', 'audit'].includes(key)) {
                          window.setTimeout(() => {
                            window.dispatchEvent(
                              new CustomEvent('pctc-tournament-category-change', {
                                detail: { category: activeCategory },
                              }),
                            );
                            window.dispatchEvent(
                              new CustomEvent('pctc-tournament-tab-change', {
                                detail: { tab: key },
                              }),
                            );
                          }, 0);
                        }
                      }}
                      className={`rounded-md border px-3 py-2 text-sm ${tab === key ? 'border-primary bg-primary/10 font-semibold' : 'border-border'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {rankingsControl && <div className="order-1 shrink-0">{rankingsControl}</div>}
              {format !== 'team' &&
                (config?.categories ?? ['mixed', 'men', 'women']).filter((category) =>
                  ['mixed', 'men', 'women'].includes(category),
                ).length > 1 && (
                  <div
                    className="order-2 ml-auto inline-flex flex-wrap rounded-md border border-border p-1"
                    role="group"
                    aria-label="Tournament category"
                  >
                    {(config?.categories ?? ['mixed', 'men', 'women'])
                      .filter((category) => ['mixed', 'men', 'women'].includes(category))
                      .map((category) => (
                        <button
                          key={category}
                          type="button"
                          aria-pressed={activeCategory === category}
                          onClick={() => {
                            setActiveCategory(category);
                            window.dispatchEvent(
                              new CustomEvent('pctc-tournament-category-change', {
                                detail: { category },
                              }),
                            );
                          }}
                          className={`rounded px-3 py-2 text-sm ${activeCategory === category ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-secondary'}`}
                        >
                          {categoryLabel(category)}
                        </button>
                      ))}
                  </div>
                )}
              {leagueTournament && adminContent && (
                <button
                  type="button"
                  onClick={openLeagueCourtModal}
                  className="ml-auto h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Assign courts
                </button>
              )}
            </div>
          )}
          {overrideEditor && adminContent && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !overrideSaving)
                  setOverrideEditor(null);
              }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="override-standings-title"
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 id="override-standings-title" className="text-lg font-semibold">
                      Override standings — Group {overrideEditor.group}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Drag rows to change positions and toggle promotion badges.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    disabled={overrideSaving}
                    onClick={() => setOverrideEditor(null)}
                    className="rounded-md px-2 py-1 hover:bg-secondary"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                  {overrideEditor.rows.map((row, index) => (
                    <DraggableItem
                      key={row.id}
                      id={row.id}
                      onDragStateChange={setDraggedEntryId}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedEntryId) moveOverrideRow(draggedEntryId, row.id);
                      }}
                      className={`flex items-center gap-3 border-b border-border p-3 last:border-b-0 ${draggedEntryId === row.id ? 'opacity-40' : ''}`}
                    >
                      <span
                        className="cursor-grab select-none text-muted-foreground"
                        aria-label="Drag to reorder"
                      >
                        ⠿
                      </span>
                      <span className="w-6 shrink-0 text-sm font-semibold">{index + 1}.</span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{row.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Move ${row.name} up`}
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => moveOverrideRow(row.id, overrideEditor.rows[index - 1].id)}
                          className="rounded border border-border px-2 py-1 text-xs leading-5 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${row.name} down`}
                          title="Move down"
                          disabled={index === overrideEditor.rows.length - 1}
                          onClick={() => moveOverrideRow(row.id, overrideEditor.rows[index + 1].id)}
                          className="rounded border border-border px-2 py-1 text-xs leading-5 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <label className="flex shrink-0 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={row.promoted}
                            onChange={(event) =>
                              setOverrideEditor((current) =>
                                current
                                  ? {
                                      ...current,
                                      rows: current.rows.map((item) =>
                                        item.id === row.id
                                          ? { ...item, promoted: event.target.checked }
                                          : item,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                          Promoted
                        </label>
                      </div>
                    </DraggableItem>
                  ))}
                </div>
                <label className="mt-4 block text-sm font-medium">
                  Reason for all changes in this group
                  <textarea
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 font-normal"
                    placeholder="Explain why the standings or promotion status changed."
                  />
                </label>
                {overrideError && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {overrideError}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={overrideSaving}
                    onClick={() => setOverrideEditor(null)}
                    className="rounded-md border border-border px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={overrideSaving || !overrideReason.trim()}
                    onClick={() => void saveGroupOverridesFromEditor()}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {overrideSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </section>
            </div>
          )}
          {['participants', 'matches', 'audit'].includes(tab) &&
          adminContent &&
          (!leagueTournament || !['matches', 'audit'].includes(tab)) ? (
            adminContent
          ) : loading ? (
            <div
              className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
                aria-hidden="true"
              />
              Loading tournament details…
            </div>
          ) : tab === 'rules' && hasRules ? (
            <section className="rounded-lg border border-border p-4" aria-label="Tournament rules">
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: safeRulesHtml(rulesHtml || '') }}
              />
            </section>
          ) : tab === 'overview' ? (
            <div className={leagueTournament ? 'flex flex-col gap-5' : 'space-y-5'}>
              {leagueTournament && (
                <div className="order-1 flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {priceCents === 0
                      ? 'Free for members'
                      : `${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(priceCents / 100)} per person`}
                  </span>
                  {Date.now() >= new Date(startsAt).getTime() &&
                    Date.now() <= new Date(endsAt || startsAt).getTime() && (
                      <span className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        In progress
                      </span>
                    )}
                  {genderRestriction && (
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs">
                      {genderRestriction === 'male'
                        ? 'Male participants only'
                        : 'Female participants only'}
                    </span>
                  )}
                </div>
              )}
              {leagueTournament && eventDescription?.trim() && (
                <p className="order-1 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
                  {eventDescription.trim()}
                </p>
              )}
              <div
                className={
                  leagueTournament
                    ? 'order-1 grid gap-3 sm:grid-cols-2'
                    : 'grid gap-3 sm:grid-cols-2'
                }
              >
                <section className="rounded-xl border border-border p-4">
                  {leagueTournament ? (
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Event</p>
                  ) : (
                    <h3 className="font-semibold">Tournament</h3>
                  )}
                  <p className="mt-2 text-sm">
                    {leagueTournament
                      ? `${dateLabel(startsAt)} · Until ${dateLabel(endsAt)}`
                      : `${dateLabel(startsAt)}${endsAt ? ` – ${dateLabel(endsAt)}` : ''}`}
                  </p>
                  {leagueTournament && (
                    <p className="mt-2 text-sm text-muted-foreground">{locationQuery}</p>
                  )}
                </section>
                <section className="rounded-xl border border-border p-4">
                  {leagueTournament ? (
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Registration
                    </p>
                  ) : (
                    <h3 className="font-semibold">Registration</h3>
                  )}
                  <p className="mt-2 text-sm">
                    {leagueTournament
                      ? `Opens ${dateLabel(registrationOpensAt)}`
                      : `Opens: ${dateLabel(registrationOpensAt)}`}
                  </p>
                  <p className="text-sm">
                    {leagueTournament
                      ? `Cutoff ${registrationClosesAt ? dateLabel(registrationClosesAt) : 'Not set'}`
                      : `Closes: ${dateLabel(registrationClosesAt || startsAt)}`}
                  </p>
                  {leagueTournament && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Active, paid membership required
                    </p>
                  )}
                </section>
              </div>
              {canViewCompetition &&
                (format === 'team'
                  ? teams.length > 0
                  : participants.some(
                      (participant) =>
                        participant.category === activeCategory &&
                        participant.status === 'registered',
                    ) ||
                    pairs.some(
                      (pair) => pair.category === activeCategory && pair.status !== 'withdrawn',
                    )) && (
                  <section
                    className={
                      leagueTournament ? 'order-4 space-y-4' : 'rounded-lg border border-border p-4'
                    }
                    aria-label={leagueTournament ? 'Players and courts' : 'Registered entries'}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3
                          className={leagueTournament ? 'text-xl font-semibold' : 'font-semibold'}
                        >
                          {leagueTournament ? 'Players and courts' : 'Registered entries'}
                        </h3>
                        {leagueTournament && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            Court assignments are shown for each sub-session.
                          </p>
                        )}
                      </div>
                      {leagueTournament && (
                        <div
                          className="flex gap-1 rounded-lg border border-border p-1"
                          role="group"
                          aria-label="Players and courts view"
                        >
                          <button
                            type="button"
                            aria-pressed={leagueCourtView === 'courts'}
                            onClick={() => setLeagueCourtView('courts')}
                            className={`rounded px-2 py-1.5 text-sm ${leagueCourtView === 'courts' ? 'bg-secondary' : ''}`}
                          >
                            Court view
                          </button>
                          <button
                            type="button"
                            aria-pressed={leagueCourtView === 'list'}
                            onClick={() => setLeagueCourtView('list')}
                            className={`rounded px-2 py-1.5 text-sm ${leagueCourtView === 'list' ? 'bg-secondary' : ''}`}
                          >
                            List view
                          </button>
                        </div>
                      )}
                    </div>
                    {leagueTournament && format !== 'team' ? (
                      leagueCourtView === 'list' ? (
                        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-muted">
                              <tr>
                                <th className="px-3 py-2">#</th>
                                <th className="px-3 py-2">Player 1</th>
                                <th className="px-3 py-2">Player 2</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Court assignments</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeLeaguePairs.map((pair, index) => {
                                const assignedMatches = matches
                                  .filter(
                                    (match) =>
                                      match.pair_one_id === pair.id ||
                                      match.pair_two_id === pair.id,
                                  )
                                  .filter((match) => match.scheduled_at || match.court_number);
                                const assignedCourts = leagueCourtAssignments.filter(
                                  (assignment) => assignment.pair_id === pair.id,
                                );
                                const pairParticipants = participants.filter(
                                  (participant) =>
                                    participant.id === pair.player_one_id ||
                                    participant.id === pair.player_two_id,
                                );
                                return (
                                  <tr key={pair.id} className="border-t border-border">
                                    <td className="px-3 py-2">{index + 1}</td>
                                    <td className="px-3 py-2">
                                      {pair.player_one_name || 'Member'}
                                      {pair.player_one_skill_level != null && (
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          {pair.player_one_skill_level}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {pair.player_two_name || 'Member'}
                                      {pair.player_two_skill_level != null && (
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          {pair.player_two_skill_level}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {pairParticipants.some(
                                        (participant) => participant.status === 'registered',
                                      )
                                        ? 'Registered'
                                        : '—'}
                                    </td>
                                    <td className="px-3 py-2">
                                      {assignedCourts.length
                                        ? assignedCourts
                                            .sort((a, b) => a.segment_order - b.segment_order)
                                            .map((assignment) => `Court ${assignment.court_number}`)
                                            .join(' → ')
                                        : assignedMatches.length
                                          ? assignedMatches
                                              .map(
                                                (match) =>
                                                  `${match.court_number ? `Court ${match.court_number}` : 'Court TBD'}${match.scheduled_at ? ` · ${dateLabel(match.scheduled_at)}` : ''}`,
                                              )
                                              .join(' / ')
                                          : 'Not assigned'}
                                    </td>
                                  </tr>
                                );
                              })}
                              {unpairedLeagueParticipants.map((participant, index) => (
                                <tr key={participant.id} className="border-t border-border">
                                  <td className="px-3 py-2">
                                    {activeLeaguePairs.length + index + 1}
                                  </td>
                                  <td className="px-3 py-2">
                                    {participant.display_name}
                                    {participant.tennis_skill_level != null && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {participant.tennis_skill_level}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">—</td>
                                  <td className="px-3 py-2">Registered</td>
                                  <td className="px-3 py-2">Not assigned</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-6">
                          {leagueCourtAssignments.length > 0 && (
                            <section>
                              <h4 className="mb-3 text-lg font-semibold">Team court assignments</h4>
                              <div className="space-y-4">
                                {Array.from(
                                  new Set(leagueCourtAssignments.map((item) => item.segment_order)),
                                )
                                  .sort((a, b) => a - b)
                                  .map((slot) => (
                                    <div key={slot}>
                                      <h5 className="mb-2 font-medium">Sub-session {slot}</h5>
                                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        {Array.from({ length: courtTotal }, (_, index) => index + 1)
                                          .map((court) => ({
                                            court,
                                            pairs: leagueCourtAssignments
                                              .filter(
                                                (assignment) =>
                                                  assignment.segment_order === slot &&
                                                  assignment.court_number === court,
                                              )
                                              .map((assignment) =>
                                                leaguePairs.find(
                                                  (pair) => pair.id === assignment.pair_id,
                                                ),
                                              )
                                              .filter((pair): pair is Pair => !!pair),
                                          }))
                                          .map(({ court, pairs: courtPairs }) => (
                                            <div
                                              key={court}
                                              className="rounded-xl border border-border p-3"
                                            >
                                              <h6 className="font-semibold">Court {court}</h6>
                                              <div className="mt-2 space-y-2 text-sm">
                                                {courtPairs.map((pair) => (
                                                  <p key={pair.id}>
                                                    {pair.player_one_name} + {pair.player_two_name}
                                                  </p>
                                                ))}
                                              </div>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </section>
                          )}
                          {!leagueTimeSlots.length && !leagueCourtAssignments.length && (
                            <p className="text-sm text-muted-foreground">
                              No court assignments yet.
                            </p>
                          )}
                          {leagueTimeSlots.map((slot) => {
                            const slotMatches = leagueScheduledMatches.filter(
                              (match) => (match.scheduled_at || 'unscheduled') === slot,
                            );
                            const courts = Array.from(
                              new Set(slotMatches.map((match) => match.court_number)),
                            ).sort((a, b) => Number(a) - Number(b));
                            return (
                              <section key={slot}>
                                <h4 className="mb-3 text-lg font-semibold">
                                  Sub-session{' '}
                                  {slot === 'unscheduled' ? 'to be announced' : dateLabel(slot)}
                                </h4>
                                <div className="grid gap-4 sm:grid-cols-2">
                                  {courts.map((court) => (
                                    <div
                                      key={court}
                                      className="rounded-xl border border-border p-4"
                                    >
                                      <h5 className="font-semibold">Court {court}</h5>
                                      <div className="mt-3 space-y-2">
                                        {slotMatches
                                          .filter((match) => match.court_number === court)
                                          .map((match) => (
                                            <div
                                              key={match.id}
                                              className="rounded-md bg-muted/40 px-3 py-2 text-sm"
                                            >
                                              <span className="mr-1 text-xs text-muted-foreground">
                                                {match.match_number}.
                                              </span>
                                              <span className="font-medium">
                                                {match.player_one_name || 'Team 1'}
                                              </span>
                                              <span> vs </span>
                                              <span className="font-medium">
                                                {match.opponent_one_name || 'Team 2'}
                                              </span>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            );
                          })}
                          {unpairedLeagueParticipants.length > 0 && (
                            <section className="rounded-md border border-dashed border-border p-3 sm:col-span-2">
                              <h4 className="font-medium">Players without an assigned team</h4>
                              <p className="mt-2 text-sm text-muted-foreground">
                                {unpairedLeagueParticipants
                                  .map((participant) => participant.display_name)
                                  .join(', ')}
                              </p>
                            </section>
                          )}
                        </div>
                      )
                    ) : null}
                    {!leagueTournament &&
                      (format === 'team' ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {teams.map((team) => (
                            <div
                              key={team.id}
                              className={`rounded-md border p-3 text-sm ${ownTeamIds.includes(team.id) ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'}`}
                            >
                              <p className="font-medium">
                                {team.name}
                                {ownTeamIds.includes(team.id) && (
                                  <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                                    You
                                  </span>
                                )}
                              </p>
                              <ul className="mt-2 space-y-1 text-muted-foreground">
                                {participants
                                  .filter((participant) => participant.team_id === team.id)
                                  .map((participant) => (
                                    <li key={participant.id} className="flex items-center gap-2">
                                      <span>{participant.display_name}</span>
                                      {participant.tennis_skill_level != null && (
                                        <span className="inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                          {participant.tennis_skill_level}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <>
                            {pairs
                              .filter(
                                (pair) =>
                                  pair.category === activeCategory && pair.status !== 'withdrawn',
                              )
                              .map((pair) => (
                                <div
                                  key={pair.id}
                                  className={`rounded-md border p-3 text-sm ${isOwnPair(pair.id) ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'}`}
                                >
                                  <span>{pair.player_one_name}</span>
                                  {pair.player_one_skill_level != null && (
                                    <span className="ml-1 inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                      {pair.player_one_skill_level}
                                    </span>
                                  )}{' '}
                                  + <span>{pair.player_two_name}</span>
                                  {pair.player_two_skill_level != null && (
                                    <span className="ml-1 inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                      {pair.player_two_skill_level}
                                    </span>
                                  )}
                                  {isOwnPair(pair.id) && (
                                    <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                                      You
                                    </span>
                                  )}
                                </div>
                              ))}
                            {participants
                              .filter(
                                (participant) =>
                                  participant.category === activeCategory &&
                                  participant.status === 'registered' &&
                                  !pairs.some(
                                    (pair) =>
                                      pair.status !== 'withdrawn' &&
                                      pair.category === activeCategory &&
                                      (pair.player_one_id === participant.id ||
                                        pair.player_two_id === participant.id),
                                  ),
                              )
                              .map((participant) => (
                                <div
                                  key={participant.id}
                                  className={`rounded-md border p-3 text-sm ${ownParticipantIds.includes(participant.id) ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'}`}
                                >
                                  <span>{participant.display_name}</span>
                                  {participant.tennis_skill_level != null && (
                                    <span className="ml-1 inline-flex rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                      {participant.tennis_skill_level}
                                    </span>
                                  )}
                                  {ownParticipantIds.includes(participant.id) && (
                                    <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                                      You
                                    </span>
                                  )}
                                </div>
                              ))}
                          </>
                        </div>
                      ))}
                    {leagueTournament && canViewCompetition && (
                      <div className="mt-5 rounded-xl border border-border p-4">
                        <h3 className="font-semibold">Waitlist</h3>
                        {participants.some(
                          (participant) =>
                            participant.category === activeCategory &&
                            participant.status === 'waitlisted',
                        ) ? (
                          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
                            {participants
                              .filter(
                                (participant) =>
                                  participant.category === activeCategory &&
                                  participant.status === 'waitlisted',
                              )
                              .map((participant) => (
                                <li key={participant.id}>{participant.display_name}</li>
                              ))}
                          </ol>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">
                            No one is on the waitlist.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                )}
              {(!winnerSummaries.length || leagueTournament) && (
                <div className={leagueTournament ? 'order-2' : undefined}>
                  <EventWeather
                    startsAt={startsAt}
                    endsAt={endsAt || undefined}
                    location={locationQuery}
                    eventLabel="tournament"
                  />
                </div>
              )}
              {tab === 'overview' && (
                <div
                  className={
                    leagueTournament
                      ? 'order-3 rounded-xl border border-border p-5'
                      : 'rounded-lg border border-border p-4'
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className={leagueTournament ? 'text-xl font-semibold' : 'font-semibold'}>
                      {leagueTournament ? 'Registration' : 'Tournament registration'}
                    </h3>
                    {leagueTournament &&
                      registrationOpen &&
                      !ownEntries.some((entry) => entry.category === leagueRegistrationCategory) &&
                      !loading &&
                      currentUserId &&
                      (ownLeagueTeamId ? (
                        <button
                          type="button"
                          disabled={registrationBusy}
                          onClick={() => void registerLeagueTeam()}
                          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                          {registrationBusy ? (
                            <TennisLoader compact label="Registering team" />
                          ) : (
                            'Register my team'
                          )}
                        </button>
                      ) : (
                        availableCategories.length > 0 && (
                          <button
                            type="button"
                            disabled={registrationBusy}
                            onClick={() => void registerLeagueSingle()}
                            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {registrationBusy ? 'Registering…' : 'Register'}
                          </button>
                        )
                      ))}
                  </div>
                  {currentUserId && ownEntries.length > 0 && (
                    <div className="mt-3 space-y-3" aria-label="Your tournament registrations">
                      {ownEntries.map((entry) => {
                        const entryPair = pairs.find(
                          (pair) =>
                            pair.status !== 'withdrawn' &&
                            pair.category === entry.category &&
                            (pair.player_one_id === entry.id || pair.player_two_id === entry.id),
                        );
                        const cutoffOpen =
                          Date.now() < new Date(registrationClosesAt || startsAt).getTime();
                        const paid =
                          entry.payment_status === 'paid' ||
                          entry.payment_status === 'not_required';
                        const pairPayment = entryPair
                          ? pairPaymentStatuses.find((status) => status.pair_id === entryPair.id)
                          : undefined;
                        const teamFullyPaid =
                          !!pairPayment &&
                          ['paid', 'not_required'].includes(
                            pairPayment.player_one_payment_status,
                          ) &&
                          ['paid', 'not_required'].includes(pairPayment.player_two_payment_status);
                        const eitherPartnerPaid =
                          !!pairPayment &&
                          ['paid', 'not_required'].some((status) =>
                            [
                              pairPayment.player_one_payment_status,
                              pairPayment.player_two_payment_status,
                            ].includes(status),
                          );
                        const paymentStatus =
                          entry.payment_status === 'paid'
                            ? 'Paid'
                            : entry.payment_status === 'not_required'
                              ? 'No payment required'
                              : entry.payment_status === 'refunded'
                                ? 'Refunded'
                                : entry.payment_status === 'failed'
                                  ? 'Payment failed'
                                  : 'Payment pending';
                        return (
                          <div
                            key={entry.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                          >
                            <div className="min-w-0">
                              <p className="font-medium">{categoryLabel(entry.category)}</p>
                              <p className="text-sm text-muted-foreground">
                                {paymentStatus}
                                {entryPair
                                  ? ` · Partner: ${entryPair.player_one_id === entry.id ? entryPair.player_two_name : entryPair.player_one_name} · Team payment: ${teamFullyPaid ? 'Paid' : 'Pending'}`
                                  : ''}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {!paid && entry.amount_cents > 0 && (
                                <button
                                  type="button"
                                  disabled={paymentBusy}
                                  onClick={() => void startTournamentPayment([entry.id])}
                                  className="h-9 rounded-md border border-primary px-3 text-sm disabled:opacity-50"
                                >
                                  {paymentBusyKey === tournamentPaymentActionKey([entry.id]) ? (
                                    <TennisLoader label="Opening payment" compact />
                                  ) : (
                                    'Pay for myself'
                                  )}
                                </button>
                              )}
                              {entry.amount_cents > 0 &&
                                entryPair &&
                                pairPayment &&
                                !teamFullyPaid &&
                                !eitherPartnerPaid && (
                                  <button
                                    type="button"
                                    disabled={paymentBusy}
                                    onClick={() =>
                                      void startTournamentPayment([
                                        entryPair.player_one_id,
                                        entryPair.player_two_id,
                                      ])
                                    }
                                    className="h-9 rounded-md border border-primary px-3 text-sm disabled:opacity-50"
                                  >
                                    {paymentBusyKey ===
                                    tournamentPaymentActionKey([
                                      entryPair.player_one_id,
                                      entryPair.player_two_id,
                                    ]) ? (
                                      <TennisLoader label="Opening payment" compact />
                                    ) : (
                                      'Pay for both partners'
                                    )}
                                  </button>
                                )}
                              {currentUserId &&
                                interacEnabled &&
                                !paid &&
                                entry.amount_cents > 0 && (
                                  <button
                                    type="button"
                                    disabled={paymentBusy}
                                    onClick={() =>
                                      void startTournamentPayment([entry.id], 'interac')
                                    }
                                    className="h-9 rounded-md border border-border px-3 text-sm disabled:opacity-50"
                                  >
                                    Pay by Interac
                                  </button>
                                )}
                              {cutoffOpen && (
                                <button
                                  type="button"
                                  disabled={paymentBusy || leagueWithdrawBusy}
                                  onClick={async () => {
                                    if (leagueTournament) {
                                      if (!entryPair) {
                                        setRegistrationError(
                                          'The League team pair could not be found. Contact the organizer before withdrawing.',
                                        );
                                        return;
                                      }
                                      setLeagueWithdrawTarget({
                                        participantId: entry.id,
                                        partnerParticipantId:
                                          entryPair.player_one_id === entry.id
                                            ? entryPair.player_two_id
                                            : entryPair.player_one_id,
                                      });
                                      setLeagueWithdrawError('');
                                      return;
                                    }
                                    const cancelResponse = await fetch('/api/payments/cancel', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ participantId: entry.id }),
                                    });
                                    const cancelResult = await cancelResponse
                                      .json()
                                      .catch(() => ({}));
                                    if (!cancelResponse.ok) {
                                      setRegistrationError(
                                        cancelResult.error ||
                                          'Could not safely cancel the pending payment.',
                                      );
                                      return;
                                    }
                                    const { error } = await db.rpc('withdraw_tournament_entry', {
                                      p_participant_id: entry.id,
                                    });
                                    if (error) setRegistrationError(error.message);
                                    else {
                                      setRegistrationMessage(
                                        `${categoryLabel(entry.category)} registration withdrawn.`,
                                      );
                                      setRegistrationRefresh((value) => value + 1);
                                    }
                                  }}
                                  className="h-9 rounded-md border border-destructive/50 px-3 text-sm text-destructive"
                                >
                                  Withdraw
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {priceCents > 0
                      ? `Entry fee: ${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(priceCents / 100)} per participant, per category. Each participant has a separate entry fee; one payer may cover both entries in a pair.`
                      : 'Registration is free.'}
                  </p>
                  {!registrationOpen ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Registration is not currently open.
                    </p>
                  ) : !currentUserId && (leagueTournament || !allowNonMemberRegistration) ? (
                    <p className="mt-3 text-sm">
                      Sign in with an approved member account to register.
                    </p>
                  ) : leagueTournament && ownLeagueTeamId ? (
                    ownEntries.some((entry) => entry.category === leagueRegistrationCategory) ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Your League team is already registered for this event.
                      </p>
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">
                        Your confirmed League partner will be registered with you.
                      </p>
                    )
                  ) : leagueTournament ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      You can register as a single player. An organizer can pair you with a League
                      team.
                    </p>
                  ) : availableCategories.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {!hasGenderEligibleCategory
                        ? 'Your recorded gender does not match any enabled doubles category. Contact the organizer if it needs to be corrected for this tournament.'
                        : currentUserId
                          ? 'You are already registered for all available categories.'
                          : 'No doubles categories are available for the entered gender.'}
                    </p>
                  ) : (
                    <form onSubmit={submitRegistration} className="mt-4 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {!leagueTournament && (
                          <label className="text-sm">
                            Category
                            <select
                              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                              value={registrationCategory}
                              onChange={(e) => {
                                setRegistrationCategory(e.target.value);
                                setPartnerChoice('');
                              }}
                              required
                            >
                              {availableCategories.map((category: string) => (
                                <option key={category} value={category}>
                                  {categoryLabel(category)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {!leagueTournament &&
                          format === 'doubles' &&
                          registrationModeConfig === 'both' && (
                            <label className="text-sm">
                              Registration type
                              <select
                                className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                                value={registrationMode}
                                onChange={(e) => {
                                  setRegistrationMode(e.target.value as 'individual' | 'pair');
                                  setPartnerChoice('');
                                }}
                              >
                                <option value="individual">
                                  Register individually; organizer can pair me later
                                </option>
                                <option value="pair">Register with a partner</option>
                              </select>
                            </label>
                          )}
                      </div>
                      {!currentUserId && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-sm">
                            Your full name
                            <Input
                              value={entrantName}
                              onChange={(e) => setEntrantName(e.target.value)}
                              required
                            />
                          </label>
                          <label className="text-sm">
                            Your email
                            <Input
                              type="email"
                              value={entrantEmail}
                              onChange={(e) => setEntrantEmail(e.target.value)}
                              required
                            />
                          </label>
                          <label className="text-sm">
                            Phone (optional)
                            <Input
                              value={entrantPhone}
                              onChange={(e) => setEntrantPhone(e.target.value)}
                            />
                          </label>
                          <label className="text-sm">
                            Tennis skill level (optional)
                            <select
                              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                              value={entrantSkillLevel}
                              onChange={(e) => setEntrantSkillLevel(e.target.value)}
                            >
                              <option value="">Not specified</option>
                              {Array.from({ length: 10 }, (_, index) =>
                                (2.5 + index * 0.5).toFixed(1),
                              ).map((level) => (
                                <option key={level} value={level}>
                                  {level}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm">
                            Gender (optional)
                            <select
                              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                              value={entrantGender}
                              onChange={(e) => setEntrantGender(e.target.value)}
                            >
                              <option value="">Not specified</option>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                            </select>
                          </label>
                        </div>
                      )}
                      {format === 'doubles' && effectiveRegistrationMode === 'pair' && (
                        <div className="space-y-3 rounded-md bg-secondary/30 p-3">
                          {!currentUserId && (
                            <p className="text-sm text-muted-foreground">
                              To play with a club member, ask that member to register both of you.
                              To add another player, enter their information below.
                            </p>
                          )}
                          {currentUserId && (
                            <label className="block text-sm">
                              Partner
                              <SearchableMemberSelect
                                value={partnerChoice}
                                onChange={setPartnerChoice}
                                placeholder="Search members by name"
                                options={
                                  [
                                    ...partnerMembers.map((member) => ({
                                      id: member.id,
                                      full_name: member.full_name,
                                      statusText: member.gender
                                        ? `Gender: ${member.gender}`
                                        : 'Club member',
                                      available:
                                        isGenderEligibleForCategory(
                                          registrationCategory,
                                          member.gender,
                                        ) &&
                                        !(
                                          registrationCategory === 'mixed' &&
                                          ['male', 'female'].includes(registrationGender || '') &&
                                          ['male', 'female'].includes(member.gender || '') &&
                                          registrationGender === member.gender
                                        ),
                                      unavailableReason: !isGenderEligibleForCategory(
                                        registrationCategory,
                                        member.gender,
                                      )
                                        ? `Not eligible for ${categoryLabel(registrationCategory)}`
                                        : 'Mixed doubles requires different known genders',
                                    })),
                                    ...(allowNonMemberRegistration
                                      ? [
                                          {
                                            id: 'new',
                                            full_name: 'Add a partner without an account',
                                            statusText: 'Enter their contact details below',
                                          },
                                        ]
                                      : []),
                                  ] as MemberOption[]
                                }
                              />
                            </label>
                          )}
                          {(!currentUserId || partnerChoice === 'new') && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="text-sm">
                                Partner name
                                <Input
                                  value={partnerName}
                                  onChange={(e) => setPartnerName(e.target.value)}
                                  required
                                />
                              </label>
                              <label className="text-sm">
                                Partner email
                                <Input
                                  type="email"
                                  value={partnerEmail}
                                  onChange={(e) => setPartnerEmail(e.target.value)}
                                  required
                                />
                              </label>
                              <label className="text-sm">
                                Partner phone (optional)
                                <Input
                                  value={partnerPhone}
                                  onChange={(e) => setPartnerPhone(e.target.value)}
                                />
                              </label>
                              <PartnerSkillLevelSelect
                                value={partnerSkillLevel}
                                onChange={setPartnerSkillLevel}
                              />
                              <label className="text-sm">
                                Partner gender (optional)
                                <select
                                  className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                                  value={partnerGender}
                                  onChange={(e) => setPartnerGender(e.target.value)}
                                >
                                  <option value="">Not specified</option>
                                  <option value="male">Male</option>
                                  <option value="female">Female</option>
                                </select>
                              </label>
                            </div>
                          )}
                          {!currentUserId &&
                            partnerChoice &&
                            partnerChoice !== 'new' &&
                            participants.some(
                              (participant) =>
                                participant.id === partnerChoice && !participant.is_member,
                            ) && (
                              <PartnerSkillLevelSelect
                                className="block text-sm"
                                value={partnerSkillLevel}
                                onChange={setPartnerSkillLevel}
                              />
                            )}
                        </div>
                      )}
                      {!leagueTournament && (
                        <button
                          type="submit"
                          disabled={registrationBusy}
                          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                          {registrationBusy ? 'Registering…' : 'Register for tournament'}
                        </button>
                      )}
                    </form>
                  )}
                  {!currentUserId && paymentParticipantIds.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={paymentBusy}
                        onClick={() =>
                          void startTournamentPayment(
                            newEntryParticipantId
                              ? [newEntryParticipantId]
                              : paymentParticipantIds.slice(0, 1),
                          )
                        }
                        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {paymentBusyKey ===
                        tournamentPaymentActionKey(
                          newEntryParticipantId
                            ? [newEntryParticipantId]
                            : paymentParticipantIds.slice(0, 1),
                        ) ? (
                          <TennisLoader label="Opening payment" compact />
                        ) : (
                          'Pay by card'
                        )}
                      </button>
                      {newPartnerParticipantId &&
                        paymentParticipantIds.includes(newPartnerParticipantId) && (
                          <button
                            type="button"
                            disabled={paymentBusy}
                            onClick={() =>
                              void startTournamentPayment(
                                [newEntryParticipantId, newPartnerParticipantId].filter(
                                  (id): id is string => Boolean(id),
                                ),
                              )
                            }
                            className="h-10 rounded-md border border-primary px-4 text-sm font-medium disabled:opacity-50"
                          >
                            {paymentBusyKey ===
                            tournamentPaymentActionKey(
                              [newEntryParticipantId, newPartnerParticipantId].filter(
                                (id): id is string => Boolean(id),
                              ),
                            ) ? (
                              <TennisLoader label="Opening payment" compact />
                            ) : (
                              'Pay for both partners'
                            )}
                          </button>
                        )}
                    </div>
                  )}
                  {interacDetails && (
                    <div className="mt-3 rounded-md border border-border p-3 text-sm">
                      <p className="font-semibold">Interac e-Transfer instructions</p>
                      <p className="mt-2">
                        Amount:{' '}
                        {new Intl.NumberFormat('en-CA', {
                          style: 'currency',
                          currency: 'CAD',
                        }).format(interacDetails.amountMinor / 100)}
                      </p>
                      <p>
                        Send to:{' '}
                        <span className="font-medium">{interacDetails.recipientEmail}</span>
                      </p>
                      <p>
                        Payment reference:{' '}
                        <span className="font-mono text-xs">{interacDetails.paymentId}</span>
                      </p>
                      {interacDetails.instructions && (
                        <p className="mt-2 whitespace-pre-wrap">{interacDetails.instructions}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!leagueTournament && ownNextMatch && (
                <div
                  role="status"
                  className={`rounded-lg border border-primary/40 bg-primary/5 p-4 ${leagueTournament ? 'order-3' : ''}`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Your next match
                  </p>
                  <p className="mt-1 font-semibold">
                    {format === 'team'
                      ? `${ownNextMatch.team_one_name || 'TBD'} vs ${ownNextMatch.team_two_name || 'TBD'}`
                      : `${ownNextMatch.player_one_name || 'TBD'} vs ${ownNextMatch.opponent_one_name || 'TBD'}`}
                  </p>
                  <p className="mt-1 text-sm">
                    {ownNextMatch.status === 'bye'
                      ? 'BYE — automatic advancement'
                      : `${dateLabel(ownNextMatch.scheduled_at)}${ownNextMatch.court_number ? ` · Court ${ownNextMatch.court_number}` : ''}`}
                  </p>
                </div>
              )}
              {leagueTournament &&
                (() => {
                  const leagueMatches = matches.filter(
                    (match) =>
                      match.phase === 'round_robin' && match.pair_one_id && match.pair_two_id,
                  );
                  const scoreableMatches = leagueMatches.filter(
                    (match) =>
                      match.status !== 'cancelled' &&
                      (canManageLeagueScores ||
                        isOwnPair(match.pair_one_id) ||
                        isOwnPair(match.pair_two_id)),
                  );
                  const selectedMatch = leagueMatches.find(
                    (match) => match.id === leagueScoreMatchId,
                  );
                  const selectedDraft = selectedMatch
                    ? (leagueScoreDrafts[selectedMatch.id] ?? { one: '', two: '' })
                    : { one: '', two: '' };
                  const pairName = (pairId: string | null) => {
                    const pair = pairs.find((item) => item.id === pairId);
                    return pair
                      ? `${pair.player_one_name} / ${pair.player_two_name}`
                      : 'League team';
                  };
                  const matchTimeLabel = (match: Match) => {
                    return `Court ${match.court_number ?? 'TBD'} · Sub-session ${match.round_number}`;
                  };
                  return (
                    <section className="order-5" aria-label="League match scores">
                      <h3 className="text-xl font-semibold">Scores</h3>
                      <div className="mt-3 space-y-2">
                        {leagueMatches
                          .filter((match) => match.status === 'completed')
                          .map((match) => (
                            <div
                              key={match.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                            >
                              <span>
                                {pairName(match.pair_one_id)}{' '}
                                <strong>
                                  {match.score_sets?.[0]?.one ?? 0} –{' '}
                                  {match.score_sets?.[0]?.two ?? 0}
                                </strong>{' '}
                                {pairName(match.pair_two_id)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {match.scheduled_at
                                  ? new Date(match.scheduled_at).toLocaleDateString('en-CA')
                                  : ''}
                              </span>
                            </div>
                          ))}
                        {!leagueMatches.some((match) => match.status === 'completed') && (
                          <p className="text-sm text-muted-foreground">
                            No scores have been entered.
                          </p>
                        )}
                      </div>
                      {currentUserId && canManageLeagueScores && !leagueEventStarted && (
                        <p className="mt-5 text-sm text-muted-foreground">
                          Score entry opens when the event starts.
                        </p>
                      )}
                      {currentUserId &&
                        leagueEventStarted &&
                        (canManageLeagueScores ||
                          (scoreableMatches.length > 0 && leagueScoresOpen)) && (
                          <form
                            className="mt-5 rounded-xl border border-border p-4"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (selectedMatch) void saveLeagueScore(selectedMatch);
                            }}
                          >
                            <h4 className="font-semibold">Add a score</h4>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {canManageLeagueScores
                                ? 'Select the court/time slot and league team. The opposing team is assigned automatically.'
                                : 'Your league team and its opponents are assigned automatically from your court/time slot.'}
                            </p>
                            <div
                              className={`mt-3 grid gap-3 sm:grid-cols-2 ${canManageLeagueScores ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
                            >
                              <label className="space-y-1 text-sm">
                                Court / sub-session
                                <select
                                  required
                                  value={leagueScoreMatchId}
                                  onChange={(event) => {
                                    const match = leagueMatches.find(
                                      (item) => item.id === event.target.value,
                                    );
                                    setLeagueScoreMatchId(event.target.value);
                                    setLeagueScoreTeamSide('1');
                                    if (match?.status === 'completed') {
                                      const ownOnOne =
                                        canManageLeagueScores || isOwnPair(match.pair_one_id);
                                      setLeagueScoreDrafts((current) => ({
                                        ...current,
                                        [match.id]: {
                                          one: String(
                                            match.score_sets?.[0]?.[ownOnOne ? 'one' : 'two'] ?? '',
                                          ),
                                          two: String(
                                            match.score_sets?.[0]?.[ownOnOne ? 'two' : 'one'] ?? '',
                                          ),
                                        },
                                      }));
                                    }
                                  }}
                                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                                >
                                  <option value="">Select assignment</option>
                                  {scoreableMatches.map((match) => (
                                    <option key={match.id} value={match.id}>
                                      {matchTimeLabel(match)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {canManageLeagueScores && selectedMatch && (
                                <label className="space-y-1 text-sm">
                                  Team
                                  <select
                                    required
                                    value={leagueScoreTeamSide}
                                    onChange={(event) => {
                                      const side = event.target.value as '1' | '2';
                                      setLeagueScoreTeamSide(side);
                                      const match = selectedMatch;
                                      if (match.status === 'completed') {
                                        const teamOneSelected = side === '1';
                                        setLeagueScoreDrafts((current) => ({
                                          ...current,
                                          [match.id]: {
                                            one: String(
                                              match.score_sets?.[0]?.[
                                                teamOneSelected ? 'one' : 'two'
                                              ] ?? '',
                                            ),
                                            two: String(
                                              match.score_sets?.[0]?.[
                                                teamOneSelected ? 'two' : 'one'
                                              ] ?? '',
                                            ),
                                          },
                                        }));
                                      }
                                    }}
                                    className="block h-10 w-full rounded-md border border-input bg-background px-3"
                                  >
                                    <option value="1">{pairName(selectedMatch.pair_one_id)}</option>
                                    <option value="2">{pairName(selectedMatch.pair_two_id)}</option>
                                  </select>
                                </label>
                              )}
                              <label className="space-y-1 text-sm">
                                {canManageLeagueScores ? 'Team score' : 'Your team score'}
                                <input
                                  required
                                  type="number"
                                  min="0"
                                  value={selectedDraft.one}
                                  onChange={(event) =>
                                    selectedMatch &&
                                    setLeagueScoreDrafts((current) => ({
                                      ...current,
                                      [selectedMatch.id]: {
                                        ...selectedDraft,
                                        one: event.target.value,
                                      },
                                    }))
                                  }
                                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                                />
                              </label>
                              <label className="space-y-1 text-sm">
                                {canManageLeagueScores ? 'Opposing team score' : 'Opponents’ score'}
                                <input
                                  required
                                  type="number"
                                  min="0"
                                  value={selectedDraft.two}
                                  onChange={(event) =>
                                    selectedMatch &&
                                    setLeagueScoreDrafts((current) => ({
                                      ...current,
                                      [selectedMatch.id]: {
                                        ...selectedDraft,
                                        two: event.target.value,
                                      },
                                    }))
                                  }
                                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                                />
                              </label>
                              <div className="flex items-end">
                                <button
                                  type="submit"
                                  disabled={
                                    !selectedMatch || savingLeagueScore === selectedMatch.id
                                  }
                                  className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                                >
                                  {selectedMatch && savingLeagueScore === selectedMatch.id
                                    ? 'Saving…'
                                    : 'Save score'}
                                </button>
                              </div>
                            </div>
                          </form>
                        )}
                    </section>
                  );
                })()}
            </div>
          ) : (
            <div className="space-y-6">
              {leagueTournament &&
                (() => {
                  const standings =
                    leagueStandingsMode === 'after' ? leagueStandingsAfter : leagueStandingsBefore;
                  const beforePositions = new Map(
                    leagueStandingsBefore.map((row) => [String(row.team_id), Number(row.position)]),
                  );
                  return (
                    <section
                      className="overflow-x-auto rounded-lg border border-border p-4"
                      aria-label="League standings"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold">League standings</h2>
                        <div
                          className="inline-flex rounded-md border border-border p-1"
                          role="group"
                          aria-label="Standings period"
                        >
                          <button
                            type="button"
                            aria-pressed={leagueStandingsMode === 'before'}
                            onClick={() => setLeagueStandingsMode('before')}
                            className={`rounded px-3 py-1.5 text-sm ${leagueStandingsMode === 'before' ? 'bg-primary text-primary-foreground' : ''}`}
                          >
                            Before this event
                          </button>
                          <button
                            type="button"
                            aria-pressed={leagueStandingsMode === 'after'}
                            onClick={() => setLeagueStandingsMode('after')}
                            className={`rounded px-3 py-1.5 text-sm ${leagueStandingsMode === 'after' ? 'bg-primary text-primary-foreground' : ''}`}
                          >
                            After this event
                          </button>
                        </div>
                      </div>
                      {leagueStandingsMode === 'after' && !leagueHasResults ? (
                        <p className="mt-4 text-sm text-muted-foreground">
                          No results are available for this event yet.
                        </p>
                      ) : !standings.length ? (
                        <p className="mt-4 text-sm text-muted-foreground">No records yet.</p>
                      ) : (
                        <table className="mt-3 w-full text-left text-sm">
                          <thead>
                            <tr>
                              <th className="p-2">Rank</th>
                              <th className="p-2">Team</th>
                              <th className="p-2">Played</th>
                              <th className="p-2">Wins</th>
                              <th className="p-2">Points</th>
                              <th className="p-2">Sets</th>
                              <th className="p-2">Games</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standings.map((row, index) => {
                              const oldPosition = beforePositions.get(String(row.team_id));
                              const delta =
                                leagueStandingsMode === 'after' && oldPosition !== undefined
                                  ? oldPosition - Number(row.position ?? index + 1)
                                  : 0;
                              return (
                                <tr
                                  key={String(row.team_id ?? index)}
                                  className="border-t border-border"
                                >
                                  <td className="p-2">{String(row.position ?? index + 1)}</td>
                                  <td className="p-2">
                                    {String(row.team_name ?? '')}
                                    {delta !== 0 && (
                                      <span
                                        aria-label={`${delta > 0 ? 'Moved up' : 'Moved down'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'place' : 'places'}`}
                                        title={`${delta > 0 ? 'Moved up' : 'Moved down'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'place' : 'places'}`}
                                        className={`ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${delta > 0 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'}`}
                                      >
                                        <Triangle
                                          aria-hidden="true"
                                          size={11}
                                          fill="currentColor"
                                          className={delta < 0 ? 'rotate-180' : undefined}
                                        />
                                        {Math.abs(delta)}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-2">{String(row.matches_played ?? 0)}</td>
                                  <td className="p-2">{String(row.wins ?? 0)}</td>
                                  <td className="p-2">{String(row.points ?? 0)}</td>
                                  <td className="p-2">
                                    {String(row.sets_won ?? 0)}–{String(row.sets_lost ?? 0)}
                                  </td>
                                  <td className="p-2">
                                    {String(row.games_won ?? 0)}–{String(row.games_lost ?? 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </section>
                  );
                })()}
              {knockoutMatches.length > 0 && (
                <details open className="space-y-3">
                  <summary className="cursor-pointer text-lg font-semibold">
                    Knockout bracket
                  </summary>
                  {[...new Set(knockoutMatches.map((match) => match.phase))].map((phase) => {
                    const phaseMatches = knockoutMatches.filter((match) => match.phase === phase);
                    const maxRound = Math.max(...phaseMatches.map((match) => match.round_number));
                    return (
                      <div key={phase} className="pb-2">
                        <h4 className="mb-3 font-medium">{phaseLabel(phase)}</h4>
                        {(() => {
                          const columnWidth = 256;
                          const columnGap = 64;
                          const slotHeight = 136;
                          const cardHeight = 112;
                          const firstRoundCount = Math.max(
                            1,
                            ...phaseMatches
                              .filter((match) => match.round_number === 1)
                              .map((match) => match.match_number),
                          );
                          const bracketHeight = 32 + firstRoundCount * slotHeight;
                          const bracketWidth = maxRound * columnWidth + (maxRound - 1) * columnGap;
                          const matchCenterY = (match: Match) =>
                            32 +
                            (match.match_number - 0.5) *
                              Math.pow(2, match.round_number - 1) *
                              slotHeight;
                          return (
                            <div className="overflow-x-auto pb-2">
                              <div
                                className="relative"
                                style={{ width: `${bracketWidth}px`, height: `${bracketHeight}px` }}
                              >
                                <svg
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-0 z-0 overflow-visible"
                                  width={bracketWidth}
                                  height={bracketHeight}
                                  viewBox={`0 0 ${bracketWidth} ${bracketHeight}`}
                                  fill="none"
                                >
                                  {phaseMatches
                                    .filter((match) => match.round_number < maxRound)
                                    .map((match) => {
                                      const nextMatchNumber = Math.ceil(match.match_number / 2);
                                      const nextMatch = phaseMatches.find(
                                        (candidate) =>
                                          candidate.round_number === match.round_number + 1 &&
                                          candidate.match_number === nextMatchNumber,
                                      );
                                      if (!nextMatch) return null;
                                      const xStart =
                                        (match.round_number - 1) * (columnWidth + columnGap) +
                                        columnWidth;
                                      const xMid = xStart + columnGap / 2;
                                      const xEnd = xStart + columnGap;
                                      const yStart = matchCenterY(match);
                                      const yEnd = matchCenterY(nextMatch);
                                      return (
                                        <path
                                          key={`advance-${match.id}`}
                                          d={`M ${xStart} ${yStart} H ${xMid} V ${yEnd} H ${xEnd}`}
                                          stroke="currentColor"
                                          strokeOpacity="0.35"
                                          strokeWidth="1.5"
                                        />
                                      );
                                    })}
                                </svg>
                                {Array.from({ length: maxRound }, (_, index) => index + 1).map(
                                  (round) => (
                                    <div
                                      key={round}
                                      className="absolute top-0 z-10"
                                      style={{
                                        left: `${(round - 1) * (columnWidth + columnGap)}px`,
                                        width: `${columnWidth}px`,
                                        height: `${bracketHeight}px`,
                                      }}
                                    >
                                      <p className="absolute left-0 top-0 h-5 text-xs font-semibold uppercase leading-5 tracking-wide text-muted-foreground">
                                        {bracketStageLabel(phase, round, maxRound)}
                                      </p>
                                      {phaseMatches
                                        .filter((match) => match.round_number === round)
                                        .map((match) => (
                                          <article
                                            key={match.id}
                                            className="absolute left-0 w-64 overflow-hidden rounded-lg border border-border bg-card p-2.5 shadow-sm"
                                            style={{
                                              top: `${matchCenterY(match) - cardHeight / 2}px`,
                                              minHeight: `${cardHeight}px`,
                                            }}
                                          >
                                            <p className="mb-1.5 text-[10px] text-muted-foreground">
                                              {bracketStageLabel(phase, round, maxRound)}{' '}
                                              {match.match_number}
                                            </p>
                                            {[1, 2].map((side) => {
                                              const isOne = side === 1;
                                              const scoreSets = match.score_sets ?? [];
                                              const isWalkover =
                                                scoreSets.length === 0 &&
                                                match.status === 'completed';
                                              const winner = match.winner_side === side;
                                              const playerLabel = bracketSideLabel(
                                                match,
                                                side as 1 | 2,
                                                maxRound,
                                              );
                                              return (
                                                <div
                                                  key={`${match.id}-side-${side}`}
                                                  className={`grid items-center gap-1 ${isOne ? 'mb-1' : ''} ${winner ? 'rounded bg-emerald-600/10 font-semibold' : ''}`}
                                                  style={{
                                                    gridTemplateColumns: `repeat(${scoreSets.length || 1}, 1.75rem) minmax(0,1fr)`,
                                                  }}
                                                >
                                                  {isWalkover && (
                                                    <span
                                                      className={`relative flex h-8 items-center justify-center rounded border border-border text-[15px] font-mono ${
                                                        winner ? 'font-bold' : ''
                                                      }`}
                                                    >
                                                      {winner ? (
                                                        <>
                                                          <span className="absolute left-[2px] top-[2px]  leading-none">
                                                            W
                                                          </span>
                                                          <span className="absolute inset-0 flex items-center justify-center text-xs font-normal">
                                                            /
                                                          </span>
                                                          <span className="absolute bottom-[2px] right-[2px] leading-none">
                                                            O
                                                          </span>
                                                        </>
                                                      ) : (
                                                        '-'
                                                      )}
                                                    </span>
                                                  )}
                                                  {scoreSets.map((set, index) => {
                                                    const score = isOne ? set.one : set.two;
                                                    const opponentScore = isOne ? set.two : set.one;
                                                    return (
                                                      <span
                                                        key={`${match.id}-${side}-set-${index}`}
                                                        className={`rounded border border-border px-1 py-1 text-center text-[15px] font-mono tabular-nums ${score > opponentScore ? 'font-bold' : ''}`}
                                                      >
                                                        {score}
                                                      </span>
                                                    );
                                                  })}
                                                  <span className="min-w-0 truncate rounded px-1.5 py-1 text-xs">
                                                    {playerLabel}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                            <p className="mt-1 text-[10px] text-muted-foreground">
                                              {match.status === 'bye'
                                                ? 'BYE — automatic advancement'
                                                : (dateLabel(match.scheduled_at) ??
                                                  'Walkover / result recorded')}
                                            </p>
                                          </article>
                                        ))}
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </details>
              )}
              {groupStandings.some(
                (group) =>
                  (format === 'team' || group.category === activeCategory) &&
                  group.standings.length > 0,
              ) && (
                <details open className="space-y-4">
                  <summary className="cursor-pointer text-lg font-semibold">
                    Group standings
                  </summary>
                  {groupStandings
                    .filter((group) => format === 'team' || group.category === activeCategory)
                    .map((group) => (
                      <div key={`${group.category}-${group.group}`}>
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-medium">Group {group.group}</h4>
                          {adminContent && (
                            <button
                              type="button"
                              onClick={() => openGroupOverrideEditor(group)}
                              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
                            >
                              Override standings
                            </button>
                          )}
                        </div>
                        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                          <table className="w-full table-fixed min-w-[36rem] text-left text-sm">
                            <thead className="bg-secondary/50">
                              <tr>
                                <th className="p-2">#</th>
                                <th className="w-[40%] p-2">Team</th>
                                <th className="p-2">Played</th>
                                {rankingColumns.map((key) => (
                                  <th key={key} className="p-2">
                                    {rankingColumnLabel[key]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {group.standings.map((row, index) => (
                                <tr
                                  key={row.id}
                                  className={`border-t border-border ${isOwnCompetitionEntry(row.id) ? 'bg-primary/10 font-semibold' : ''}`}
                                >
                                  <td className="p-2">{index + 1}</td>
                                  <td className="p-2 font-medium">
                                    {row.name}
                                    {groupOverrides.some(
                                      (item) =>
                                        item.category === group.category &&
                                        item.group_number === group.group &&
                                        item.entry_id === row.id &&
                                        item.override_type === 'ranking' &&
                                        item.override_value !== row.automaticPosition,
                                    ) && (
                                      <span
                                        title={
                                          groupOverrides.find(
                                            (item) =>
                                              item.category === group.category &&
                                              item.group_number === group.group &&
                                              item.entry_id === row.id &&
                                              item.override_type === 'ranking',
                                          )?.reason
                                        }
                                        className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-800 dark:text-amber-300"
                                      >
                                        !
                                      </span>
                                    )}
                                    {(() => {
                                      const promotionOverride = groupOverrides.find(
                                        (item) =>
                                          item.category === group.category &&
                                          item.group_number === group.group &&
                                          item.entry_id === row.id &&
                                          item.override_type === 'promotion',
                                      );
                                      const promotionEnabled =
                                        format === 'team'
                                          ? enabledPhases.team_round_robin !== false &&
                                            enabledPhases.team_knockout !== false
                                          : enabledPhases.round_robin !== false &&
                                            enabledPhases.final_knockout !== false;
                                      const automaticallyPromoted =
                                        group.standings.some((standing) => standing.played > 0) &&
                                        promotionEnabled &&
                                        index <
                                          Math.max(
                                            1,
                                            Number(config?.promoted_teams_per_group ?? 2),
                                          );
                                      if (promotionOverride?.override_value === 0) return null;
                                      if (
                                        promotionOverride?.override_value === 1 ||
                                        automaticallyPromoted
                                      ) {
                                        const pending =
                                          !categoryVisibleMatches.some(
                                            (match) =>
                                              match.phase.includes('round_robin') &&
                                              match.group_number === group.group &&
                                              match.category === group.category,
                                          ) ||
                                          categoryVisibleMatches.some(
                                            (match) =>
                                              match.phase.includes('round_robin') &&
                                              match.group_number === group.group &&
                                              match.category === group.category &&
                                              match.status !== 'completed',
                                          );
                                        return (
                                          <span className="ml-2 inline-flex rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                            {promotionOverride?.override_value === 1
                                              ? 'Promoted'
                                              : pending
                                                ? 'Pending promotion'
                                                : 'Promoted'}
                                          </span>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </td>
                                  <td className="p-2">{row.played}</td>
                                  {rankingColumns.map((key) => (
                                    <td key={key} className="p-2">
                                      {key === 'points'
                                        ? row.points
                                        : key === 'matches_won'
                                          ? row.wins
                                          : key === 'sets_won'
                                            ? row.setsFor
                                            : key === 'games_won'
                                              ? row.gamesFor
                                              : key === 'set_difference'
                                                ? row.setsFor - row.setsAgainst
                                                : row.gamesFor - row.gamesAgainst}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {[
                          ...new Set(
                            groupOverrides
                              .filter(
                                (item) =>
                                  item.category === group.category &&
                                  item.group_number === group.group,
                              )
                              .map((item) => item.reason)
                              .filter(Boolean),
                          ),
                        ].map((reason) => (
                          <p key={reason} className="mt-2 text-sm text-muted-foreground">
                            Standings override: {reason}
                          </p>
                        ))}
                      </div>
                    ))}
                </details>
              )}
              {!resultsOnly &&
                (categoryVisibleMatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No matches have been scheduled for this category yet.
                  </p>
                ) : (
                  <details open className="space-y-3">
                    <summary className="cursor-pointer text-lg font-semibold">
                      Match schedule and results
                    </summary>
                    {!leagueTournament &&
                      categoryVisibleMatches.some((match) =>
                        match.phase.includes('round_robin'),
                      ) && (
                        <div
                          className="inline-flex rounded-md border border-border p-1"
                          role="group"
                          aria-label="Group round-robin matches by"
                        >
                          {(['group', 'round'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={competitionMatchGrouping === mode}
                              onClick={() => setCompetitionMatchGrouping(mode)}
                              className={`rounded px-3 py-2 text-sm ${competitionMatchGrouping === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
                            >
                              By {mode}
                            </button>
                          ))}
                        </div>
                      )}
                    {([format === 'team' ? 'team' : activeCategory] as const)
                      .filter((category) =>
                        categoryVisibleMatches.some((m) => m.category === category),
                      )
                      .map((category) => (
                        <div key={category} className="space-y-3">
                          {[
                            'preliminary_knockout',
                            'final_knockout',
                            'team_knockout',
                            'round_robin',
                            'team_round_robin',
                          ]
                            .filter((phase) =>
                              categoryVisibleMatches.some(
                                (m) => m.category === category && m.phase === phase,
                              ),
                            )
                            .map((phase) => (
                              <div key={phase}>
                                {!leagueTournament && (
                                  <h4 className="font-medium">{phaseLabel(phase)}</h4>
                                )}
                                {(() => {
                                  const phaseMatches = categoryVisibleMatches
                                    .filter((m) => m.category === category && m.phase === phase)
                                    .sort((a, b) => {
                                      if (
                                        phase.includes('knockout') &&
                                        a.round_number !== b.round_number
                                      )
                                        return a.round_number - b.round_number;
                                      return compareByScheduleThenCourt(a, b);
                                    });
                                  const isRoundRobin = phase.includes('round_robin');
                                  const isKnockout = phase.includes('knockout');
                                  const stageCount = Math.max(
                                    1,
                                    ...phaseMatches.map((m) => m.round_number),
                                  );
                                  const grouped = isRoundRobin
                                    ? Array.from(
                                        new Set<string>(
                                          phaseMatches.map((m) =>
                                            competitionMatchGrouping === 'group'
                                              ? `Group ${m.group_number ?? 'Unassigned'}`
                                              : `Round ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`,
                                          ),
                                        ),
                                      ).map((title) => ({
                                        title,
                                        matches: phaseMatches.filter(
                                          (m) =>
                                            (competitionMatchGrouping === 'group'
                                              ? `Group ${m.group_number ?? 'Unassigned'}`
                                              : `Round ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`) ===
                                            title,
                                        ),
                                      }))
                                    : isKnockout
                                      ? Array.from(
                                          new Set(
                                            phaseMatches.map((m) =>
                                              knockoutStageLabel(m.round_number, stageCount),
                                            ),
                                          ),
                                        ).map((title) => ({
                                          title,
                                          matches: phaseMatches.filter(
                                            (m) =>
                                              knockoutStageLabel(m.round_number, stageCount) ===
                                              title,
                                          ),
                                        }))
                                      : [{ title: '', matches: phaseMatches }];
                                  return (
                                    <div className="mt-2 space-y-4">
                                      {grouped.map((group) => (
                                        <section key={group.title || phase} className="space-y-2">
                                          {!leagueTournament && group.title && (
                                            <h5 className="text-sm font-semibold text-muted-foreground">
                                              {group.title}
                                            </h5>
                                          )}
                                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                            {group.matches.map((m) => (
                                              <article
                                                key={m.id}
                                                className={`rounded-lg border border-border p-3 ${isOwnPair(m.pair_one_id) || isOwnPair(m.pair_two_id) || (format === 'team' && (ownTeamIds.includes(m.team_one_id || '') || ownTeamIds.includes(m.team_two_id || ''))) ? 'border-primary/40 bg-primary/[0.04]' : ''}`}
                                              >
                                                <div
                                                  className="grid items-center gap-x-2 gap-y-1"
                                                  style={{
                                                    gridTemplateColumns: (m.score_sets ?? []).length
                                                      ? `repeat(${m.score_sets.length}, 2.25rem) minmax(0,1fr)`
                                                      : 'minmax(0,1fr)',
                                                  }}
                                                >
                                                  {(m.score_sets ?? []).map((set, index) => (
                                                    <span
                                                      key={`one-${index}`}
                                                      className={`rounded border border-border px-1 py-1 text-center text-[15px] font-mono tabular-nums ${set.one > set.two ? 'font-bold' : ''}`}
                                                    >
                                                      {set.one}
                                                    </span>
                                                  ))}
                                                  <div
                                                    className={`min-w-0 truncate ${m.winner_side === 1 ? 'font-semibold' : ''}`}
                                                  >
                                                    {m.phase.includes('knockout')
                                                      ? bracketSideLabel(
                                                          m,
                                                          1,
                                                          Math.max(
                                                            1,
                                                            ...categoryVisibleMatches
                                                              .filter(
                                                                (item) => item.phase === m.phase,
                                                              )
                                                              .map((item) => item.round_number),
                                                          ),
                                                        )
                                                      : format === 'team'
                                                        ? m.team_one_name || 'TBD'
                                                        : m.player_one_name || 'TBD'}
                                                    {(format === 'team'
                                                      ? ownTeamIds.includes(m.team_one_id || '')
                                                      : isOwnPair(m.pair_one_id)) && (
                                                      <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                                                        You
                                                      </span>
                                                    )}
                                                  </div>
                                                  {(m.score_sets ?? []).map((set, index) => (
                                                    <span
                                                      key={`two-${index}`}
                                                      className={`rounded border border-border px-1 py-1 text-center text-[15px] font-mono tabular-nums ${set.two > set.one ? 'font-bold' : ''}`}
                                                    >
                                                      {set.two}
                                                    </span>
                                                  ))}
                                                  <div
                                                    className={`min-w-0 truncate ${m.winner_side === 2 ? 'font-semibold' : ''}`}
                                                  >
                                                    {m.phase.includes('knockout')
                                                      ? bracketSideLabel(
                                                          m,
                                                          2,
                                                          Math.max(
                                                            1,
                                                            ...categoryVisibleMatches
                                                              .filter(
                                                                (item) => item.phase === m.phase,
                                                              )
                                                              .map((item) => item.round_number),
                                                          ),
                                                        )
                                                      : format === 'team'
                                                        ? m.team_two_name || 'TBD'
                                                        : m.opponent_one_name || 'TBD'}
                                                    {(format === 'team'
                                                      ? ownTeamIds.includes(m.team_two_id || '')
                                                      : isOwnPair(m.pair_two_id)) && (
                                                      <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary">
                                                        You
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                                <p className="mt-2 text-xs text-muted-foreground">
                                                  {[
                                                    m.group_number
                                                      ? `Group ${m.group_number}`
                                                      : null,
                                                    m.phase.includes('knockout')
                                                      ? `${knockoutStageLabel(m.round_number, Math.max(1, ...categoryVisibleMatches.filter((item) => item.phase === m.phase).map((item) => item.round_number)))} ${m.match_number}`
                                                      : `${leagueTournament ? 'Sub-session' : 'Round'} ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`,
                                                    m.status === 'bye'
                                                      ? null
                                                      : dateLabel(m.scheduled_at),
                                                    m.status !== 'bye' &&
                                                    m.scheduled_at &&
                                                    !leagueTournament
                                                      ? `Ends ${formatTime(new Date(new Date(m.scheduled_at).getTime() + Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000))}`
                                                      : null,
                                                    m.court_number
                                                      ? `Court ${m.court_number}`
                                                      : null,
                                                  ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                                </p>
                                                {!(m.score_sets ?? []).length && (
                                                  <p className="mt-1 text-xs text-muted-foreground">
                                                    {m.status === 'bye'
                                                      ? 'Walkover — winner advances'
                                                      : m.status === 'completed'
                                                        ? 'Walkover / result recorded'
                                                        : 'Upcoming'}
                                                  </p>
                                                )}
                                                {format === 'team' && m.status === 'completed' && (
                                                  <p className="mt-2 text-xs text-muted-foreground">
                                                    Team standings points: {m.team_points_one} –{' '}
                                                    {m.team_points_two}
                                                  </p>
                                                )}
                                                {format === 'team' &&
                                                  currentUserId &&
                                                  ([1, 2] as const)
                                                    .filter(
                                                      (side) =>
                                                        m.status !== 'completed' &&
                                                        m.status !== 'cancelled' &&
                                                        (() => {
                                                          const teamId =
                                                            side === 1
                                                              ? m.team_one_id
                                                              : m.team_two_id;
                                                          return (
                                                            !!teamId &&
                                                            teams.some(
                                                              (team) =>
                                                                team.id === teamId &&
                                                                team.captain_user_id ===
                                                                  currentUserId,
                                                            )
                                                          );
                                                        })(),
                                                    )
                                                    .map((side) => {
                                                      const teamId = (
                                                        side === 1 ? m.team_one_id : m.team_two_id
                                                      )!;
                                                      const currentSidePlayers =
                                                        matchPlayers.filter(
                                                          (p) =>
                                                            p.match_id === m.id &&
                                                            p.team_id === teamId,
                                                        );
                                                      const roster = participants.filter(
                                                        (p) => p.team_id === teamId,
                                                      );
                                                      return (
                                                        <div
                                                          key={`${m.id}-pairing-${side}`}
                                                          className="mt-3 rounded-md bg-secondary/30 p-3"
                                                        >
                                                          <p className="text-sm font-medium">
                                                            Your team pairing (
                                                            {side === 1 ? 'Side one' : 'Side two'})
                                                          </p>
                                                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                                            <label className="text-xs">
                                                              Player one
                                                              <select
                                                                id={`captain-pair-${m.id}-${side}-a`}
                                                                className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                                                defaultValue={
                                                                  currentSidePlayers[0]
                                                                    ?.participant_id ?? ''
                                                                }
                                                              >
                                                                <option value="">
                                                                  Select player
                                                                </option>
                                                                {roster.map((p) => (
                                                                  <option key={p.id} value={p.id}>
                                                                    {p.display_name}
                                                                  </option>
                                                                ))}
                                                              </select>
                                                            </label>
                                                            <label className="text-xs">
                                                              Player two
                                                              <select
                                                                id={`captain-pair-${m.id}-${side}-b`}
                                                                className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                                                defaultValue={
                                                                  currentSidePlayers[1]
                                                                    ?.participant_id ?? ''
                                                                }
                                                              >
                                                                <option value="">
                                                                  Select player
                                                                </option>
                                                                {roster
                                                                  .filter(
                                                                    (p) =>
                                                                      p.id !==
                                                                      currentSidePlayers[0]
                                                                        ?.participant_id,
                                                                  )
                                                                  .map((p) => (
                                                                    <option key={p.id} value={p.id}>
                                                                      {p.display_name}
                                                                    </option>
                                                                  ))}
                                                              </select>
                                                            </label>
                                                          </div>
                                                          <button
                                                            type="button"
                                                            onClick={() =>
                                                              void saveCaptainPairing(
                                                                m,
                                                                teamId,
                                                                side,
                                                              )
                                                            }
                                                            className="mt-2 h-8 rounded-md border border-border px-3 text-sm"
                                                          >
                                                            Save pairing
                                                          </button>
                                                        </div>
                                                      );
                                                    })}
                                                {format === 'team' &&
                                                  currentUserId &&
                                                  teams.some(
                                                    (team) =>
                                                      team.captain_user_id === currentUserId &&
                                                      (team.id === m.team_one_id ||
                                                        team.id === m.team_two_id),
                                                  ) && (
                                                    <div className="mt-3 flex flex-wrap items-end gap-2">
                                                      <label className="text-xs">
                                                        Edit result (sets)
                                                        <input
                                                          id={`captain-score-${m.id}`}
                                                          defaultValue={(m.score_sets ?? [])
                                                            .map((set) => `${set.one}-${set.two}`)
                                                            .join(', ')}
                                                          placeholder="6-4, 3-6, 10-8"
                                                          className="mt-1 block h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
                                                        />
                                                      </label>
                                                      <button
                                                        type="button"
                                                        onClick={() => void saveCaptainScore(m)}
                                                        className="h-9 rounded-md border border-border px-3 text-sm"
                                                      >
                                                        Save result
                                                      </button>
                                                    </div>
                                                  )}
                                              </article>
                                            ))}
                                          </div>
                                        </section>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            ))}
                        </div>
                      ))}
                  </details>
                ))}
            </div>
          )}
        </>
      )}
      {leagueCourtModalOpen && (
        <LeagueCourtAssignmentDialog
          courtSessionCount={leagueCourtSessionCount}
          courtTotal={courtTotal}
          leaguePairs={leaguePairs}
          leagueCourtDraft={leagueCourtDraft}
          leagueCourtSaving={leagueCourtSaving}
          leagueCourtError={leagueCourtError}
          setLeagueCourtDraft={setLeagueCourtDraft}
          setLeagueCourtSessionCount={setLeagueCourtSessionCount}
          onClose={() => setLeagueCourtModalOpen(false)}
          onMoveLeaguePairToCourt={moveLeaguePairToCourt}
          onUnassignLeaguePair={unassignLeaguePair}
          onSaveLeagueCourtAssignments={() => void saveLeagueCourtAssignments()}
        />
      )}
      {leagueWithdrawTarget && (
        <ConfirmDialog
          open
          title="Withdraw your League team?"
          description={
            <>
              <p>
                Withdrawing will remove you and your confirmed partner from this event. Both players
                will be withdrawn together.
              </p>
              {leagueWithdrawError && (
                <p role="alert" className="mt-3 text-destructive">
                  {leagueWithdrawError}
                </p>
              )}
            </>
          }
          confirmLabel="Withdraw team"
          destructive
          busy={leagueWithdrawBusy}
          onCancel={() => {
            setLeagueWithdrawTarget(null);
            setLeagueWithdrawError('');
          }}
          onConfirm={() => void confirmLeagueTeamWithdrawal()}
        />
      )}
      {leagueCourtConfirmation && (
        <ConfirmDialog
          open
          title="Court assignment warnings"
          description={`${leagueCourtWarnings.map(({ session, court, count }) => `Sub-session ${session}, Court ${court} has ${count} teams (${count * 2} player places; maximum 4).`).join('\n')}\n\nSave these assignments anyway?`}
          confirmLabel="Save anyway"
          busy={leagueCourtSaving}
          onCancel={() => setLeagueCourtConfirmation(false)}
          onConfirm={() => {
            setLeagueCourtConfirmation(false);
            void saveLeagueCourtAssignments(true);
          }}
        />
      )}
    </section>
  );
}
