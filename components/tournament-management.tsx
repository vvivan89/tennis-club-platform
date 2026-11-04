'use client';

import { useTimedFeedback } from '@/hooks/use-timed-feedback';
import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { formatDateTime, formatTime } from '@/lib/time-format';
import type { TournamentConfig } from '@/lib/tournament-config';
import { FloatingFeedback } from '@/components/floating-feedback';
import { type TournamentAuditRow } from '@/components/tournament-audit-log';
import { TournamentAuditSection } from '@/components/tournament-audit-section';
import { TournamentReplacePairDialog } from '@/components/tournament-replace-pair-dialog';
import { TournamentManagementConfirmations } from '@/components/tournament-management-confirmations';
import { TournamentParticipantManagementPanel } from '@/components/tournament-participant-management-panel';
import { TournamentMatchManagementPanel } from '@/components/tournament-match-management-panel';
import { useTournamentParticipantActions } from '@/components/use-tournament-participant-actions';
import type {
  Match,
  MatchPlayer,
  Member,
  Pair,
  Participant,
  Team,
} from '@/components/tournament-management-types';
import { useTournamentMatchActions } from '@/components/use-tournament-match-actions';
import { useTournamentDrawActions } from '@/components/use-tournament-draw-actions';
import { useTournamentAdminMatchView } from '@/components/use-tournament-admin-match-view';
import { getTournamentDrawStatus } from '@/components/tournament-draw-status';
import {
  getTournamentManagementUiSettings,
  getVisibleTournamentAuditRows,
} from '@/components/tournament-management-ui';
import { useTournamentMatchSideOptions } from '@/components/use-tournament-match-side-options';
import { useTournamentCourtActions } from '@/components/use-tournament-court-actions';

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
  captainMode = false,
  captainTeamId = null,
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
  captainMode?: boolean;
  captainTeamId?: string | null;
}) {
  const db = createSupabaseBrowserClient();
  const [teams, setTeams] = useState<Team[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchPlayers, setMatchPlayers] = useState<MatchPlayer[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [auditRows, setAuditRows] = useState<TournamentAuditRow[]>([]);
  const [adminTab, setAdminTab] = useState<'participants' | 'matches' | 'audit'>(
    captainMode ? 'matches' : 'participants',
  );
  const [externalTab, setExternalTab] = useState<
    'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit'
  >(captainMode ? 'matches' : 'participants');
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
  const { busy, setBusy, error, setError, message, setMessage } = useTimedFeedback();
  const [teamName, setTeamName] = useState('');
  const [teamColor, setTeamColor] = useState('');
  const [teamLogo, setTeamLogo] = useState<File | null>(null);
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
    (config?.categories ?? ['mixed', 'men', 'women'])[0] ?? 'mixed',
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
      (captainMode ? db.from('tournament_public_teams') : db.from('tournament_teams'))
        .select('*')
        .eq('event_id', eventId)
        .order('name'),
      (captainMode
        ? db.from('tournament_public_participants').select('*')
        : db
            .from('tournament_participants')
            .select(
              'id,user_id,team_id,category,payment_status,amount_cents,display_name,email,phone,gender,gender_override,status,captain_requested',
            )
      )
        .eq('event_id', eventId)
        .order('display_name'),
      (captainMode ? db.from('tournament_public_pairs') : db.from('tournament_pairs'))
        .select('*')
        .eq('event_id', eventId)
        .order('category'),
      db
        .from(captainMode ? 'tournament_public_matches' : 'tournament_matches')
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
    const nextMembers = (memberResult.data ?? []) as Member[];
    const memberGenderById = new Map(nextMembers.map((member) => [member.id, member.gender]));
    const nextParticipants = ((participantResult.data ?? []) as Participant[]).map(
      (participant) => ({
        ...participant,
        gender:
          participant.gender_override ??
          participant.gender ??
          (participant.user_id ? memberGenderById.get(participant.user_id) : null) ??
          null,
      }),
    );
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
    const { data: playerRows, error: playerRowsError } = captainMode
      ? await db.rpc('event_tournament_visible_match_lineups', { p_event_id: eventId })
      : matchIds.length
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
    } else if (captainMode) {
      setError(`Could not load your saved match lineups: ${playerRowsError.message}`);
    }
    const nextAuditRows = (auditResult.data ?? []) as TournamentAuditRow[];
    setMembers((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextMembers) ? previous : nextMembers,
    );
    setAuditRows((previous) =>
      JSON.stringify(previous) === JSON.stringify(nextAuditRows) ? previous : nextAuditRows,
    );
    window.dispatchEvent(new CustomEvent('pctc-tournament-data-refresh', { detail: { eventId } }));
  }, [captainMode, db, eventId, leagueTournament, setError]);

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
        if (category !== 'overall') setMatchCategory(category);
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
  const isTeam = format === 'team';
  const participantActions = useTournamentParticipantActions({
    db,
    eventId,
    leagueId,
    priceCents,
    leagueTournament,
    leagueGender,
    isTeam,
    activeCategory,
    state: {
      participants,
      members,
      pairs,
      matches,
      matchPlayers,
      pairCategory,
      memberId,
      participantName,
      participantEmail,
      participantPhone,
      participantGender,
      teamName,
      teamColor,
      teamLogo,
      captain,
      pairOne,
      pairTwo,
      replacementParticipantId,
      leagueMemberEligibility,
    },
    setters: {
      setBusy,
      setError,
      setMessage,
      setMemberId,
      setParticipantName,
      setParticipantEmail,
      setParticipantPhone,
      setParticipantGender,
      setTeamName,
      setTeamColor,
      setTeamLogo,
      setCaptain,
      setPairOne,
      setPairTwo,
    },
    refresh,
  });
  const {
    activeParticipants,
    hasOpposingGenderProfile,
    profileGenderLabel,
    availablePairPlayers,
    pairPlayerOption,
    replacementRestriction,
    runAction,
    removeParticipant,
    assignParticipantTeam,
    addParticipant,
    addTeam,
    createPair,
    replacePairPlayer,
  } = participantActions;
  const matchSideOptionsState = useTournamentMatchSideOptions({
    isTeam,
    activeCategory,
    config,
    teams,
    pairs,
    matches,
    matchOne,
    matchTwo,
    matchCategory,
    matchPhase,
  });
  const { matchSideValue } = matchSideOptionsState;
  const saveCaptainPairing = async (
    match: Match,
    teamId: string,
    side: 1 | 2,
    first: string,
    second: string,
    visibleToPublic: boolean,
  ) => {
    if (!first || !second || first === second) {
      setError('Choose two different players for your lineup.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: saveError } = await db.rpc('save_tournament_captain_match_lineup', {
        p_match_id: match.id,
        p_team_id: teamId,
        p_player_one: first,
        p_player_two: second,
        p_visible_to_public: visibleToPublic,
      });
      if (saveError) throw new Error(saveError.message);
      setMatchPlayers((current) => [
        ...current.filter((player) => !(player.match_id === match.id && player.team_id === teamId)),
        { match_id: match.id, participant_id: first, side, team_id: teamId },
        { match_id: match.id, participant_id: second, side, team_id: teamId },
      ]);
      setMatches((current) =>
        current.map((item) =>
          item.id === match.id
            ? {
                ...item,
                team_one_lineup_public: side === 1 ? visibleToPublic : item.team_one_lineup_public,
                team_two_lineup_public: side === 2 ? visibleToPublic : item.team_two_lineup_public,
              }
            : item,
        ),
      );
      setMessage('Your lineup was saved.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your lineup.');
    } finally {
      setBusy(false);
    }
  };
  const matchActions = useTournamentMatchActions({
    db,
    eventId,
    eventStartsAt,
    eventEndsAt,
    courtCount,
    format,
    config,
    isTeam,
    activeCategory,
    state: {
      matches,
      pairs,
      teams,
      participants,
      matchPlayers,
      matchCategory,
      matchPhase,
      matchOne,
      matchTwo,
      matchTime,
      matchCourt,
      teamPairSelection,
      pendingScheduleConflicts,
    },
    setters: {
      setBusy,
      setError,
      setMessage,
      setMatchCourt,
      setMatchTime,
      setPendingScheduleConflicts,
    },
    refresh,
    runAction,
    localDateTime,
    matchSideValue,
    scheduleTimings: {
      duration: Math.max(30, Number(config?.schedule?.match_minutes ?? 60)),
      breakMinutes: Math.max(10, Number(config?.schedule?.break_minutes ?? 15)),
    },
  });
  const { insertMatchPlayers, saveMatch, confirmResolveScheduleConflicts } = matchActions;
  const { phases, enabledPhases, scheduleTimings, groupOptions } =
    getTournamentManagementUiSettings(config);
  const drawActions = useTournamentDrawActions({
    db,
    eventId,
    eventStartsAt,
    eventEndsAt,
    courtCount,
    activeCategory,
    isTeam,
    matchCategory,
    matchPhase,
    config,
    enabledPhases,
    scheduleTimings,
    teams,
    pairs,
    matches,
    matchPlayers,
    pendingDeleteMatch,
    refresh,
    insertMatchPlayers,
    saveMatch,
    runAction,
    setBusy,
    setError,
    setMessage,
    setPendingDeleteMatch,
    setPendingWalkoverScore,
  });
  const { saveEntryGroup, randomizeGroups, confirmDeleteMatch, saveScore } = drawActions;
  const {
    unevenTeams,
    availableMatchPhases,
    availablePhaseKey,
    bracketNeedsRedraw,
    knockoutBracketHasResults,
  } = getTournamentDrawStatus({
    config,
    enabledPhases,
    phases,
    isTeam,
    activeCategory,
    matchCategory,
    matchPhase,
    teams,
    participants,
    pairs,
    matches,
  });
  useEffect(() => {
    const availableKeys = availablePhaseKey ? availablePhaseKey.split(',') : [];
    if (availableKeys.length && !availableKeys.includes(matchPhase))
      setMatchPhase(availableKeys[0]);
  }, [availablePhaseKey, matchPhase]);
  const adminMatchView = useTournamentAdminMatchView({
    matches,
    isTeam,
    activeCategory,
    matchCategory,
    matchPhase,
    matchGrouping,
    config,
    courtCount,
    teams,
    pairs,
  });
  const { adminMatchList } = adminMatchView;

  const courtActions = useTournamentCourtActions({
    db,
    config,
    matches,
    pendingCourtMove,
    setPendingCourtMove,
    runAction,
  });
  const { confirmCourtMove } = courtActions;

  const visibleAuditRows = getVisibleTournamentAuditRows(
    auditRows,
    isTeam,
    activeCategory,
    participants,
    pairs,
    matches,
  );

  return (
    <section className="space-y-6" aria-label="Tournament administration">
      <FloatingFeedback error={error} message={message} />
      {externalTab !== 'competition' && adminTab === 'participants' && (
        <TournamentParticipantManagementPanel
          eventId={eventId}
          isTeam={isTeam}
          leagueTournament={leagueTournament}
          activeCategory={activeCategory}
          members={members}
          participants={participants}
          pairs={pairs}
          teams={teams}
          groupCount={Math.max(1, Number(config?.group_count ?? 2))}
          availablePairPlayers={availablePairPlayers}
          leagueMemberEligibility={leagueMemberEligibility}
          groupOptions={groupOptions}
          busy={busy}
          unevenTeams={unevenTeams}
          db={db}
          priceCents={priceCents}
          memberId={memberId}
          participantName={participantName}
          participantEmail={participantEmail}
          participantPhone={participantPhone}
          participantGender={participantGender}
          teamName={teamName}
          teamColor={teamColor}
          teamLogo={teamLogo}
          captain={captain}
          pairCategory={pairCategory}
          pairOne={pairOne}
          pairTwo={pairTwo}
          pairPlayerOption={pairPlayerOption}
          profileGenderLabel={profileGenderLabel}
          hasOpposingGenderProfile={hasOpposingGenderProfile}
          runAction={runAction}
          addParticipant={addParticipant}
          addTeam={addTeam}
          createPair={createPair}
          randomizeGroups={() => void randomizeGroups()}
          saveEntryGroup={saveEntryGroup}
          assignParticipantTeam={assignParticipantTeam}
          setMemberId={setMemberId}
          setParticipantName={setParticipantName}
          setParticipantEmail={setParticipantEmail}
          setParticipantPhone={setParticipantPhone}
          setParticipantGender={setParticipantGender}
          setTeamName={setTeamName}
          setTeamColor={setTeamColor}
          setTeamLogo={setTeamLogo}
          setCaptain={setCaptain}
          setPairOne={setPairOne}
          setPairTwo={setPairTwo}
          setPendingRemoveParticipant={setPendingRemoveParticipant}
          setReplacementParticipantId={setReplacementParticipantId}
          setReplaceTarget={setReplaceTarget}
        />
      )}
      {externalTab !== 'competition' && adminTab === 'matches' && (
        <TournamentMatchManagementPanel
          {...matchSideOptionsState}
          {...matchActions}
          {...drawActions}
          {...adminMatchView}
          {...courtActions}
          isTeam={isTeam}
          captainMode={captainMode}
          captainTeamId={captainTeamId}
          busy={busy}
          config={config}
          courtCount={courtCount}
          activeParticipants={activeParticipants}
          adminMatchList={
            captainMode
              ? matches
                  .filter(
                    (match) =>
                      match.team_one_id === captainTeamId || match.team_two_id === captainTeamId,
                  )
                  .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
              : adminMatchList
          }
          availableMatchPhases={availableMatchPhases}
          bracketNeedsRedraw={bracketNeedsRedraw}
          knockoutBracketHasResults={knockoutBracketHasResults}
          matchCategory={matchCategory}
          matchPhase={matchPhase}
          matchGrouping={matchGrouping}
          setMatchGrouping={setMatchGrouping}
          matchOne={matchOne}
          matchTwo={matchTwo}
          setMatchOne={setMatchOne}
          setMatchTwo={setMatchTwo}
          setMatchPhase={setMatchPhase}
          matchTime={matchTime}
          setMatchTime={setMatchTime}
          matchCourt={matchCourt}
          setMatchCourt={setMatchCourt}
          teamPairSelection={teamPairSelection}
          setTeamPairSelection={setTeamPairSelection}
          matchPlayers={matchPlayers}
          matches={matches}
          pairs={pairs}
          teams={teams}
          formatDateTime={formatDateTime}
          formatTime={formatTime}
          localDateTime={localDateTime}
          saveCaptainPairing={saveCaptainPairing}
        />
      )}
      {externalTab !== 'competition' && adminTab === 'audit' && (
        <TournamentAuditSection
          rows={visibleAuditRows}
          participants={participants}
          teams={teams}
          pairs={pairs}
          matches={matches}
          members={members}
        />
      )}
      <TournamentManagementConfirmations
        busy={busy}
        scheduleConflictCount={pendingScheduleConflicts?.conflicts.length ?? 0}
        courtMove={pendingCourtMove}
        participant={pendingRemoveParticipant}
        walkoverPending={!!pendingWalkoverScore}
        deletePending={!!pendingDeleteMatch}
        onCancelSchedule={() => setPendingScheduleConflicts(null)}
        onConfirmSchedule={() => void confirmResolveScheduleConflicts()}
        onCancelCourtMove={() => setPendingCourtMove(null)}
        onConfirmCourtMove={() => void confirmCourtMove()}
        onCancelParticipant={() => setPendingRemoveParticipant(null)}
        onConfirmParticipant={() => {
          const target = pendingRemoveParticipant;
          setPendingRemoveParticipant(null);
          if (target) void removeParticipant(target);
        }}
        onCancelWalkover={() => setPendingWalkoverScore(null)}
        onConfirmWalkover={() => {
          const pending = pendingWalkoverScore;
          setPendingWalkoverScore(null);
          if (pending) void saveScore(pending.match, pending.raw, true);
        }}
        onCancelDelete={() => setPendingDeleteMatch(null)}
        onConfirmDelete={() => void confirmDeleteMatch()}
      />
      <TournamentReplacePairDialog
        target={replaceTarget}
        participants={activeParticipants}
        selectedParticipantId={replacementParticipantId}
        setSelectedParticipantId={setReplacementParticipantId}
        busy={busy}
        profileGenderLabel={profileGenderLabel}
        hasOpposingGenderProfile={hasOpposingGenderProfile}
        replacementRestriction={replacementRestriction}
        onCancel={() => {
          setReplaceTarget(null);
          setReplacementParticipantId('');
        }}
        onReplace={async (target) => {
          const saved = await replacePairPlayer(target.pair, target.side);
          if (saved) {
            setReplaceTarget(null);
            setReplacementParticipantId('');
          }
          return saved;
        }}
      />
    </section>
  );
}
