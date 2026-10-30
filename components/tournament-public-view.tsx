'use client';

import { formatDateTime, formatTime } from '@/lib/time-format';
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
import { Sparkles, Trophy } from 'lucide-react';
import { TennisLoader } from '@/components/tennis-loader';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';

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
type Match = {
  id: string;
  event_id: string;
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
}: {
  adminContent?: ReactNode;
  eventTitle?: string;
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
}) {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  useEffect(() => {
    if (eventTitle) document.title = `PCTC | ${eventTitle}`;
  }, [eventTitle]);
  const hasRules = Boolean(rulesHtml?.trim());
  const [tab, setTab] = useState<
    'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit'
  >('overview');
  const [tabInitialized, setTabInitialized] = useState(false);
  const [competitionMatchGrouping, setCompetitionMatchGrouping] = useState<'group' | 'round'>(
    'group',
  );
  useEffect(() => {
    const readTabFromUrl = () => {
      const requested = new URLSearchParams(window.location.search).get('tab');
      if (
        ['overview', 'rules', 'competition', 'participants', 'matches', 'audit'].includes(
          requested || '',
        ) &&
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
  }, [hasRules]);
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
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationError, setRegistrationError] = useState('');
  const [registrationMessage, setRegistrationMessage] = useState('');
  useEffect(() => {
    if (!registrationError && !registrationMessage) return;
    const timer = window.setTimeout(() => {
      setRegistrationError('');
      setRegistrationMessage('');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [registrationError, registrationMessage]);
  const [paymentParticipantIds, setPaymentParticipantIds] = useState<string[]>([]);
  const [newEntryParticipantId, setNewEntryParticipantId] = useState<string | null>(null);
  const [newPartnerParticipantId, setNewPartnerParticipantId] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentBusyKey, setPaymentBusyKey] = useState<string | null>(null);
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
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [db, eventId, currentUserId, registrationRefresh]);
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
      if (!isGenderEligibleForCategory(registrationCategory, entrantGenderValue))
        throw new Error(
          `The entered gender is not eligible for ${categoryLabel(registrationCategory)}.`,
        );
      if (
        effectiveRegistrationMode === 'pair' &&
        partnerChoice &&
        partnerChoice !== 'new' &&
        !isGenderEligibleForCategory(registrationCategory, partnerGenderValue)
      )
        throw new Error(
          `The selected partner's gender is not eligible for ${categoryLabel(registrationCategory)}.`,
        );
      if (
        effectiveRegistrationMode === 'pair' &&
        useNewPartner &&
        !isGenderEligibleForCategory(registrationCategory, partnerGenderValue)
      )
        throw new Error(
          `The partner's gender is not eligible for ${categoryLabel(registrationCategory)}.`,
        );
      if (
        registrationCategory === 'mixed' &&
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
        p_category: registrationCategory,
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
    if (
      [1, 2].some(
        (side) =>
          matchPlayers.filter(
            (player) =>
              player.match_id === match.id &&
              player.side === side &&
              player.team_id === (side === 1 ? match.team_one_id : match.team_two_id),
          ).length !== 2,
      )
    ) {
      window.alert(
        'Assign two players to each team before recording the result so individual records remain accurate.',
      );
      return;
    }
    const input = document.getElementById(`captain-score-${match.id}`) as HTMLInputElement | null;
    const raw = input?.value ?? '';
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
        (set) =>
          !Number.isInteger(set.one) ||
          !Number.isInteger(set.two) ||
          set.one < 0 ||
          set.two < 0 ||
          set.one === set.two,
      )
    ) {
      window.alert('Enter decisive set scores like 6-4, 3-6, 10-8.');
      return;
    }
    if (config?.scoring_template === 'one_set' && sets.length !== 1) {
      window.alert('This scoring template requires exactly one set.');
      return;
    }
    if (
      config?.scoring_template === 'best_of_three' &&
      (sets.length > 3 ||
        Math.max(
          sets.filter((set) => set.one > set.two).length,
          sets.filter((set) => set.two > set.one).length,
        ) < 2)
    ) {
      window.alert(
        'Best-of-three requires a player to win two sets, with no more than three sets.',
      );
      return;
    }
    if (
      config?.scoring_template === 'two_sets_then_third' &&
      (sets.length < 2 ||
        sets.length > 3 ||
        (sets[0].one > sets[0].two === sets[1].one > sets[1].two && sets.length !== 2) ||
        (sets[0].one > sets[0].two !== sets[1].one > sets[1].two && sets.length !== 3))
    ) {
      window.alert('Play two sets; add a deciding third set only when the first two are split.');
      return;
    }
    if (
      config?.scoring_template === 'team_two_sets_bonus_third' &&
      (sets.length < 2 ||
        sets.length > 3 ||
        (sets[0].one > sets[0].two === sets[1].one > sets[1].two && sets.length !== 2) ||
        (sets[0].one > sets[0].two !== sets[1].one > sets[1].two && sets.length !== 3))
    ) {
      window.alert(
        'This team scoring template requires two sets, plus a third set if the first two are split.',
      );
      return;
    }
    const winsOne = sets.filter((set) => set.one > set.two).length;
    const winsTwo = sets.filter((set) => set.two > set.one).length;
    if (winsOne === winsTwo) {
      window.alert('The set scores must identify a winner.');
      return;
    }
    const winner = winsOne > winsTwo ? 1 : 2;
    let pointsOne = winner === 1 ? 1 : 0;
    let pointsTwo = winner === 2 ? 1 : 0;
    if (config?.scoring_template === 'team_two_sets_bonus_third') {
      const firstTwo = sets.slice(0, 2);
      const a = firstTwo.filter((set) => set.one > set.two).length;
      const b = firstTwo.filter((set) => set.two > set.one).length;
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
  const roundRobinRoundByMatch = useMemo(() => {
    const roundNumberByMatch = new Map<string, number>();
    const counts = new Map<string, number>();
    const roundRobinMatches = categoryVisibleMatches
      .filter(
        (match) =>
          match.phase.includes('round_robin') &&
          match.status !== 'cancelled' &&
          match.status !== 'bye',
      )
      .sort((a, b) => {
        const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || a.match_number - b.match_number;
      });
    for (const match of roundRobinMatches) {
      const first = format === 'team' ? match.team_one_id : match.pair_one_id;
      const second = format === 'team' ? match.team_two_id : match.pair_two_id;
      const firstRound = first ? (counts.get(first) ?? 0) + 1 : match.round_number;
      const secondRound = second ? (counts.get(second) ?? 0) + 1 : match.round_number;
      if (first) counts.set(first, firstRound);
      if (second) counts.set(second, secondRound);
      roundNumberByMatch.set(match.id, Math.min(firstRound, secondRound));
    }
    return roundNumberByMatch;
  }, [categoryVisibleMatches, format]);
  const isOwnPair = (pairId: string | null | undefined) => {
    if (!pairId || !currentUserId) return false;
    const pair = pairs.find((item) => item.id === pairId);
    return (
      !!pair &&
      (ownParticipantIds.includes(pair.player_one_id) ||
        ownParticipantIds.includes(pair.player_two_id))
    );
  };
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
    format === 'team'
      ? ['team']
      : (config?.categories ?? ['mixed', 'men', 'women']).filter(
          (category: string) =>
            !ownCategories.includes(category) &&
            !(category === 'men' && ownCategories.includes('women')) &&
            !(category === 'women' && ownCategories.includes('men')) &&
            !(category === 'men' && registrationGender !== null && registrationGender !== 'male') &&
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
    registrationModeConfig === 'single'
      ? 'individual'
      : registrationModeConfig === 'doubles'
        ? 'pair'
        : registrationMode;
  useEffect(() => {
    if (availableCategories.length && !availableCategories.includes(registrationCategory))
      setRegistrationCategory(availableCategories[0]);
  }, [availableCategories.join(','), registrationCategory, entrantGender]);
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
    const priority: string[] =
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
          ]);
    const value = (
      row: {
        wins: number;
        points: number;
        setsFor: number;
        setsAgainst: number;
        gamesFor: number;
        gamesAgainst: number;
      },
      key: string,
    ) =>
      key === 'points'
        ? row.points
        : key === 'matches_won'
          ? row.wins
          : key === 'sets_won'
            ? row.setsFor
            : key === 'games_won'
              ? row.gamesFor
              : key === 'set_difference'
                ? row.setsFor - row.setsAgainst
                : key === 'game_difference'
                  ? row.gamesFor - row.gamesAgainst
                  : 0;
    return [...groups.values()]
      .sort((a, b) => a.group - b.group || a.category.localeCompare(b.category))
      .map((group) => {
        const standings = [...group.rows.values()].sort((a, b) => {
          for (const key of priority) {
            if (key === 'head_to_head') {
              const direct = visibleMatches.find(
                (match) =>
                  match.category === group.category &&
                  match.group_number === group.group &&
                  match.status === 'completed' &&
                  ((format === 'team' &&
                    match.team_one_id === a.id &&
                    match.team_two_id === b.id) ||
                    (format === 'team' &&
                      match.team_one_id === b.id &&
                      match.team_two_id === a.id) ||
                    (format !== 'team' &&
                      match.pair_one_id === a.id &&
                      match.pair_two_id === b.id) ||
                    (format !== 'team' &&
                      match.pair_one_id === b.id &&
                      match.pair_two_id === a.id)),
              );
              if (direct?.winner_side) {
                const aWon =
                  direct.team_one_id === a.id || direct.pair_one_id === a.id
                    ? direct.winner_side === 1
                    : direct.winner_side === 2;
                if (aWon) return -1;
                return 1;
              }
              continue;
            }
            const diff = value(b, key) - value(a, key);
            if (diff) return diff;
          }
          return a.name.localeCompare(b.name);
        });
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
    const rankingPriority =
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
          ]);
    const metric = (
      row: {
        wins: number;
        points: number;
        setsFor: number;
        setsAgainst: number;
        gamesFor: number;
        gamesAgainst: number;
      },
      key: string,
    ) =>
      key === 'points'
        ? row.points
        : key === 'matches_won'
          ? row.wins
          : key === 'sets_won'
            ? row.setsFor
            : key === 'games_won'
              ? row.gamesFor
              : key === 'set_difference'
                ? row.setsFor - row.setsAgainst
                : key === 'game_difference'
                  ? row.gamesFor - row.gamesAgainst
                  : 0;
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
  return (
    <section className="space-y-5">
      {(registrationError || registrationMessage) && (
        <div
          className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
          aria-live="polite"
        >
          {registrationError && (
            <p
              role="alert"
              className="pointer-events-auto rounded-md border border-destructive/30 bg-background p-3 text-sm text-destructive shadow-lg"
            >
              {registrationError}
            </p>
          )}
          {registrationMessage && (
            <p
              role="status"
              className="pointer-events-auto rounded-md border border-emerald-600/30 bg-background p-3 text-sm shadow-lg"
            >
              {registrationMessage}
            </p>
          )}
        </div>
      )}
      {(canViewCompetition || !!adminContent) && (
        <>
          {winnerSummaries.length > 0 && (
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tournament details">
              {(
                [
                  ['overview', 'Overview'],
                  ...(hasRules ? ([['rules', 'Rules']] as Array<[typeof tab, string]>) : []),
                  ['competition', 'Groups, Schedule & Results'],
                  ...(adminContent
                    ? [
                        ['participants', 'Participants'],
                        ['matches', 'Matches'],
                        ['audit', 'Audit log'],
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
            {format !== 'team' &&
              (config?.categories ?? ['mixed', 'men', 'women']).filter((category) =>
                ['mixed', 'men', 'women'].includes(category),
              ).length > 1 && (
                <div
                  className="inline-flex flex-wrap rounded-md border border-border p-1"
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
          </div>
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
                    <div
                      key={row.id}
                      draggable
                      onDragStart={() => setDraggedEntryId(row.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedEntryId) moveOverrideRow(draggedEntryId, row.id);
                        setDraggedEntryId(null);
                      }}
                      onDragEnd={() => setDraggedEntryId(null)}
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
                    </div>
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
          {['participants', 'matches', 'audit'].includes(tab) && adminContent ? (
            adminContent
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading tournament details…</p>
          ) : tab === 'rules' && hasRules ? (
            <section className="rounded-lg border border-border p-4" aria-label="Tournament rules">
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: safeRulesHtml(rulesHtml || '') }}
              />
            </section>
          ) : tab === 'overview' ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <section className="rounded-lg border border-border p-4">
                  <h3 className="font-semibold">Tournament</h3>
                  <p className="mt-2 text-sm">
                    {dateLabel(startsAt)}
                    {endsAt ? ` – ${dateLabel(endsAt)}` : ''}
                  </p>
                </section>
                <section className="rounded-lg border border-border p-4">
                  <h3 className="font-semibold">Registration</h3>
                  <p className="mt-2 text-sm">Opens: {dateLabel(registrationOpensAt)}</p>
                  <p className="mt-1 text-sm">
                    Closes: {dateLabel(registrationClosesAt || startsAt)}
                  </p>
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
                    className="rounded-lg border border-border p-4"
                    aria-label="Registered entries"
                  >
                    <h3 className="font-semibold">Registered entries</h3>
                    {format === 'team' ? (
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
                    )}
                  </section>
                )}
              {!winnerSummaries.length && (
                <EventWeather
                  startsAt={startsAt}
                  endsAt={endsAt || undefined}
                  location={locationQuery}
                  eventLabel="tournament"
                />
              )}
              {tab === 'overview' && (
                <div className="rounded-lg border border-border p-4">
                  <h3 className="font-semibold">Tournament registration</h3>
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
                                  disabled={paymentBusy}
                                  onClick={async () => {
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
                  ) : !currentUserId && !allowNonMemberRegistration ? (
                    <p className="mt-3 text-sm">
                      Sign in with an approved member account to register.
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
                        {format === 'doubles' && registrationModeConfig === 'both' && (
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
                              <label className="text-sm">
                                Partner tennis skill level (optional)
                                <select
                                  className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                                  value={partnerSkillLevel}
                                  onChange={(e) => setPartnerSkillLevel(e.target.value)}
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
                              <label className="block text-sm">
                                Partner tennis skill level (optional)
                                <select
                                  className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                                  value={partnerSkillLevel}
                                  onChange={(e) => setPartnerSkillLevel(e.target.value)}
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
                            )}
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={registrationBusy}
                        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {registrationBusy ? 'Registering…' : 'Register for tournament'}
                      </button>
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
              {ownNextMatch && (
                <div role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-4">
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
            </div>
          ) : (
            <div className="space-y-6">
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
              {categoryVisibleMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No matches have been scheduled for this category yet.
                </p>
              ) : (
                <details open className="space-y-3">
                  <summary className="cursor-pointer text-lg font-semibold">
                    Match schedule and results
                  </summary>
                  {categoryVisibleMatches.some((match) => match.phase.includes('round_robin')) && (
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
                              <h4 className="font-medium">{phaseLabel(phase)}</h4>
                              {(() => {
                                const phaseMatches = categoryVisibleMatches
                                  .filter((m) => m.category === category && m.phase === phase)
                                  .sort((a, b) => {
                                    if (
                                      phase.includes('knockout') &&
                                      a.round_number !== b.round_number
                                    )
                                      return a.round_number - b.round_number;
                                    const aTime = a.scheduled_at
                                      ? new Date(a.scheduled_at).getTime()
                                      : Number.MAX_SAFE_INTEGER;
                                    const bTime = b.scheduled_at
                                      ? new Date(b.scheduled_at).getTime()
                                      : Number.MAX_SAFE_INTEGER;
                                    return (
                                      aTime - bTime ||
                                      (a.court_number ?? Number.MAX_SAFE_INTEGER) -
                                        (b.court_number ?? Number.MAX_SAFE_INTEGER)
                                    );
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
                                        {group.title && (
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
                                                  m.group_number ? `Group ${m.group_number}` : null,
                                                  m.phase.includes('knockout')
                                                    ? `${knockoutStageLabel(m.round_number, Math.max(1, ...categoryVisibleMatches.filter((item) => item.phase === m.phase).map((item) => item.round_number)))} ${m.match_number}`
                                                    : `Round ${roundRobinRoundByMatch.get(m.id) ?? m.round_number}`,
                                                  m.status === 'bye'
                                                    ? null
                                                    : dateLabel(m.scheduled_at),
                                                  m.status !== 'bye' && m.scheduled_at
                                                    ? `Ends ${formatTime(new Date(new Date(m.scheduled_at).getTime() + Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000))}`
                                                    : null,
                                                  m.court_number ? `Court ${m.court_number}` : null,
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
                                                    const currentSidePlayers = matchPlayers.filter(
                                                      (p) =>
                                                        p.match_id === m.id && p.team_id === teamId,
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
                                                            void saveCaptainPairing(m, teamId, side)
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
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
