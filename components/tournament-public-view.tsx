'use client';
import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { TennisLoader } from '@/components/tennis-loader';
import { FloatingFeedback } from '@/components/floating-feedback';
import { useLeagueEventCourtActions } from '@/components/use-league-event-court-actions';
import { TournamentGroupOverrideDialog } from '@/components/tournament-group-override-dialog';
import { TournamentPublicViewControls } from '@/components/tournament-public-view-controls';
import { TournamentCompetitionResults } from '@/components/tournament-competition-results';
import { getTournamentRankingColumns } from '@/components/tournament-ranking-columns';
import { createTournamentBracketLabels } from '@/components/tournament-bracket-labels';
import { getTournamentRegistrationOptions } from '@/components/tournament-registration-options';
import { useTournamentPublicViewData } from '@/components/use-tournament-public-view-data';
import { useTournamentCaptainActions } from '@/components/use-tournament-captain-actions';
import { useLeagueEventScoreActions } from '@/components/use-league-event-score-actions';
import { useTournamentPaymentAction } from '@/components/use-tournament-payment-action';
import { useTournamentVisibleMatchData } from '@/components/use-tournament-visible-match-data';
import { useTournamentPublicViewSubscriptions } from '@/components/use-tournament-public-view-subscriptions';
import { useTournamentInvitationActions } from '@/components/use-tournament-invitation-actions';
import { useTournamentEntryEditActions } from '@/components/use-tournament-entry-edit-actions';
import { useLeagueEventRegistrationActions } from '@/components/use-league-event-registration-actions';
import { useTournamentWithdrawalActions } from '@/components/use-tournament-withdrawal-actions';
import { useTournamentRegistrationSubmit } from '@/components/use-tournament-registration-submit';
import { TournamentPublicViewDialogs } from '@/components/tournament-public-view-dialogs';
import { sanitizeHtml } from '@/lib/sanitize-html';
import type { TournamentPublicViewProps } from '@/components/tournament-public-view-types';
import { tournamentPaymentActionKey } from '@/components/tournament-public-view-format';
import { TournamentOverviewPanel } from '@/components/tournament-overview-panel';
import { buildTournamentGroupStandings } from '@/components/tournament-public-group-standings';
import { buildTournamentWinnerSummaries } from '@/components/tournament-winner-summaries';
import { useTournamentGroupOverrideActions } from '@/components/use-tournament-group-override-actions';
import { useTournamentPublicViewUiState } from '@/components/use-tournament-public-view-ui-state';
export function TournamentPublicView({
  adminContent = null,
  eventTitle = '',
  eventDescription = '',
  genderRestriction = null,
  eventSlug = '',
  eventId,
  currentUserId,
  currentUserEmail = null,
  currentUserAccountKind = 'member',
  currentUserName = '',
  currentUserPhone = '',
  currentUserSkillLevel = null,
  currentUserGender = null,
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
}: TournamentPublicViewProps) {
  const db = useMemo(() => createSupabaseBrowserClient(), []),
    router = useRouter();
  useEffect(() => {
    if (eventTitle) document.title = `PCTC | ${eventTitle}`;
  }, [eventTitle]);
  const hasRules = Boolean(rulesHtml?.trim()) && !leagueTournament;
  const isEventGuest = !!currentUserId && currentUserAccountKind === 'event_guest';
  const canManageLeagueScores = leagueTournament && Boolean(adminContent);
  const ui = useTournamentPublicViewUiState({
    resultsOnly,
    startsAt,
    leagueTournament,
    config,
    format,
    currentUserName,
    currentUserEmail,
    currentUserPhone,
    currentUserGender,
    currentUserSkillLevel,
    hasRules,
  });
  const {
    setNewEntryParticipantId,
    setNewPartnerParticipantId,
    setPaymentParticipantIds,
    setPartnerConfirmation,
    setPartnerConfirmationError,
    setRegistrationCategory,
  } = ui;
  const {
    teams,
    groupOverrides,
    setGroupOverrides,
    participants,
    partnerMembers,
    pairPaymentStatuses,
    pairs,
    matches,
    setMatches,
    matchPlayers,
    setMatchPlayers,
    ownParticipantIds,
    ownEntries,
    profileGender,
    ownCategories,
    ownTeamIds,
    ownLeagueTeamId,
    loading,
    leagueCourtAssignments,
    setLeagueCourtAssignments,
    interacRequests,
    setInteracRequests,
  } = useTournamentPublicViewData({
    db,
    eventId,
    currentUserId,
    currentUserGender,
    leagueTournament,
    leagueId,
    interacEnabled,
    registrationRefresh: ui.registrationRefresh,
    setPaymentParticipantIds: ui.setPaymentParticipantIds,
  });
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
  }, [setNewEntryParticipantId, setNewPartnerParticipantId, setPaymentParticipantIds]);
  useEffect(() => {
    if (!currentUserId || typeof window === 'undefined') return;
    const participantId = new URLSearchParams(window.location.search).get('confirm_partner');
    if (!participantId) return;
    let active = true;
    setPartnerConfirmationError('');
    void fetch(
      `/api/events/partner-confirmation?participantId=${encodeURIComponent(participantId)}`,
      {
        cache: 'no-store',
      },
    )
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) throw new Error(result.error || 'This invitation could not be loaded.');
        setPartnerConfirmation({
          participantId,
          participantName: result.participant.displayName,
          email: result.participant.email,
          phone: result.participant.phone,
          gender: result.participant.gender,
          tennisSkillLevel: result.participant.tennisSkillLevel,
          eventTitle: result.event.title,
          invitedBy: result.invitedBy,
        });
      })
      .catch((error) => {
        if (active)
          setPartnerConfirmationError(
            error instanceof Error ? error.message : 'This invitation could not be loaded.',
          );
      });
    return () => {
      active = false;
    };
  }, [currentUserId, setPartnerConfirmation, setPartnerConfirmationError]);
  useTournamentPublicViewSubscriptions({
    db,
    eventId,
    setActiveCategory: ui.setActiveCategory,
    setRegistrationRefresh: ui.setRegistrationRefresh,
    refreshPage: () => router.refresh(),
  });
  const { requestEventGuestAccess, requestPartnerInvitation, confirmPartnerParticipation } =
    useTournamentInvitationActions({
      eventId,
      leagueTournament,
      guestAccessEmail: ui.guestAccessEmail,
      partnerConfirmation: ui.partnerConfirmation,
      setGuestAccessBusy: ui.setGuestAccessBusy,
      setGuestAccessError: ui.setGuestAccessError,
      setGuestAccessMessage: ui.setGuestAccessMessage,
      setRegistrationMessage: ui.setRegistrationMessage,
      setPartnerConfirmation: ui.setPartnerConfirmation,
      setPartnerConfirmationBusy: ui.setPartnerConfirmationBusy,
      setPartnerConfirmationError: ui.setPartnerConfirmationError,
      setRegistrationRefresh: ui.setRegistrationRefresh,
    });

  const { savePartnerChange, switchToSingle, saveOwnEventDetails } = useTournamentEntryEditActions({
    db,
    partnerEditName: ui.partnerEditName,
    partnerEditEmail: ui.partnerEditEmail,
    partnerEditPhone: ui.partnerEditPhone,
    partnerEditGender: ui.partnerEditGender,
    partnerEditSkill: ui.partnerEditSkill,
    ownEditName: ui.ownEditName,
    ownEditPhone: ui.ownEditPhone,
    ownEditGender: ui.ownEditGender,
    ownEditSkill: ui.ownEditSkill,
    requestPartnerInvitation,
    setPartnerEditBusy: ui.setPartnerEditBusy,
    setPartnerEditTarget: ui.setPartnerEditTarget,
    setOwnEditBusy: ui.setOwnEditBusy,
    setOwnEditTarget: ui.setOwnEditTarget,
    setRegistrationError: ui.setRegistrationError,
    setRegistrationMessage: ui.setRegistrationMessage,
    setRegistrationRefresh: ui.setRegistrationRefresh,
  });

  const { registerLeagueTeam } = useLeagueEventRegistrationActions({
    db,
    eventId,
    currentUserId,
    ownLeagueTeamId,
    priceCents,
    setRegistrationBusy: ui.setRegistrationBusy,
    setRegistrationError: ui.setRegistrationError,
    setRegistrationMessage: ui.setRegistrationMessage,
    setNewEntryParticipantId: ui.setNewEntryParticipantId,
    setNewPartnerParticipantId: ui.setNewPartnerParticipantId,
    setPaymentParticipantIds: ui.setPaymentParticipantIds,
    setRegistrationRefresh: ui.setRegistrationRefresh,
  });

  const { confirmLeagueTeamWithdrawal, confirmTournamentWithdrawal } =
    useTournamentWithdrawalActions({
      db,
      ownEntries,
      withdrawTarget: ui.withdrawTarget,
      leagueWithdrawTarget: ui.leagueWithdrawTarget,
      setWithdrawTarget: ui.setWithdrawTarget,
      setWithdrawBusy: ui.setWithdrawBusy,
      setWithdrawError: ui.setWithdrawError,
      setLeagueWithdrawTarget: ui.setLeagueWithdrawTarget,
      setLeagueWithdrawBusy: ui.setLeagueWithdrawBusy,
      setLeagueWithdrawError: ui.setLeagueWithdrawError,
      setRegistrationMessage: ui.setRegistrationMessage,
      setRegistrationRefresh: ui.setRegistrationRefresh,
    });
  const { startTournamentPayment } = useTournamentPaymentAction({
    eventId,
    currentUserId,
    paymentParticipantIds: ui.paymentParticipantIds,
    newEntryParticipantId: ui.newEntryParticipantId,
    newPartnerParticipantId: ui.newPartnerParticipantId,
    setPaymentBusy: ui.setPaymentBusy,
    setPaymentBusyKey: ui.setPaymentBusyKey,
    setRegistrationError: ui.setRegistrationError,
    setRegistrationMessage: ui.setRegistrationMessage,
    setInteracRequests,
    setInteracNotice: ui.setInteracNotice,
  });
  const { saveCaptainPairing, saveCaptainScore } = useTournamentCaptainActions({
    db,
    currentUserId,
    config,
    matchPlayers,
    setMatchPlayers,
    setMatches,
  });
  const {
    ownNextMatch,
    enabledPhases,
    visibleMatches,
    categoryVisibleMatches,
    roundRobinRoundByMatch,
  } = useTournamentVisibleMatchData({
    matches,
    pairs,
    config,
    format,
    activeCategory: ui.activeCategory,
    ownTeamIds,
    ownParticipantIds,
  });
  const isOwnPair = (pairId: string | null | undefined) => {
    if (!pairId || !currentUserId) return false;
    const pair = pairs.find((item) => item.id === pairId);
    return (
      !!pair &&
      (ownParticipantIds.includes(pair.player_one_id) ||
        ownParticipantIds.includes(pair.player_two_id))
    );
  };
  const { saveLeagueScore } = useLeagueEventScoreActions({
    db,
    startsAt,
    canManageLeagueScores,
    leagueScoreDrafts: ui.leagueScoreDrafts,
    leagueScoreTeamSide: ui.leagueScoreTeamSide,
    isOwnPair,
    setSavingLeagueScore: ui.setSavingLeagueScore,
    setMatches,
    setLeagueScoreDrafts: ui.setLeagueScoreDrafts,
    refreshPage: () => router.refresh(),
  });
  const isOwnCompetitionEntry = (entryId: string) =>
    format === 'team' ? ownTeamIds.includes(entryId) : isOwnPair(entryId);
  const knockoutMatches = categoryVisibleMatches
    .filter((match) => match.phase.includes('knockout'))
    .sort((a, b) => a.round_number - b.round_number || a.match_number - b.match_number);
  const { stageLabel: bracketStageLabel, sideLabel: bracketSideLabel } =
    createTournamentBracketLabels({ format, knockoutMatches, teams, pairs });
  const canViewCompetition = detailsPublic || (!!currentUserId && ownParticipantIds.length > 0);
  const leagueRegistrationCategory = leagueGender === 'male' ? 'men' : 'women';
  const registrationGender = isEventGuest
    ? ui.entrantGender || null
    : currentUserId
      ? profileGender
      : ui.entrantGender || null;
  const { hasGenderEligibleCategory: _hasGenderEligibleCategory, availableCategories } =
    getTournamentRegistrationOptions({
      config,
      format,
      leagueTournament,
      leagueRegistrationCategory,
      ownCategories,
      registrationGender,
      currentUserId,
    });
  const hasGenderEligibleCategory = _hasGenderEligibleCategory;
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
        : ui.registrationMode;
  const { submitRegistration } = useTournamentRegistrationSubmit({
    db,
    eventId,
    currentUserEmail,
    currentUserId,
    isEventGuest,
    leagueTournament,
    leagueRegistrationCategory,
    registrationCategory: ui.registrationCategory,
    effectiveRegistrationMode,
    entrantName: ui.entrantName,
    entrantEmail: ui.entrantEmail,
    entrantPhone: ui.entrantPhone,
    entrantGender: ui.entrantGender,
    entrantSkillLevel: ui.entrantSkillLevel,
    partnerChoice: ui.partnerChoice,
    partnerName: ui.partnerName,
    partnerEmail: ui.partnerEmail,
    partnerPhone: ui.partnerPhone,
    partnerGender: ui.partnerGender,
    partnerSkillLevel: ui.partnerSkillLevel,
    profileGender,
    partnerMembers,
    participants,
    priceCents,
    requestPartnerInvitation,
    setRegistrationBusy: ui.setRegistrationBusy,
    setRegistrationError: ui.setRegistrationError,
    setRegistrationMessage: ui.setRegistrationMessage,
    setNewEntryParticipantId: ui.setNewEntryParticipantId,
    setNewPartnerParticipantId: ui.setNewPartnerParticipantId,
    setPaymentParticipantIds: ui.setPaymentParticipantIds,
    setPartnerChoice: ui.setPartnerChoice,
    setEntrantName: ui.setEntrantName,
    setEntrantEmail: ui.setEntrantEmail,
    setEntrantPhone: ui.setEntrantPhone,
    setEntrantGender: ui.setEntrantGender,
    setEntrantSkillLevel: ui.setEntrantSkillLevel,
    setPartnerName: ui.setPartnerName,
    setPartnerEmail: ui.setPartnerEmail,
    setPartnerPhone: ui.setPartnerPhone,
    setPartnerGender: ui.setPartnerGender,
    setPartnerSkillLevel: ui.setPartnerSkillLevel,
    setRegistrationRefresh: ui.setRegistrationRefresh,
  });
  const firstAvailableCategory = availableCategories[0];
  const registrationCategoryIsAvailable = availableCategories.includes(ui.registrationCategory);
  useEffect(() => {
    if (firstAvailableCategory && !registrationCategoryIsAvailable)
      setRegistrationCategory(firstAvailableCategory);
  }, [firstAvailableCategory, registrationCategoryIsAvailable, setRegistrationCategory]);
  const groupStandings = useMemo(
    () =>
      buildTournamentGroupStandings({
        visibleMatches,
        teams,
        pairs,
        config,
        format,
        groupOverrides,
      }),
    [visibleMatches, teams, pairs, config, format, groupOverrides],
  );
  const {
    overrideEditor,
    setOverrideEditor,
    overrideReason,
    setOverrideReason,
    overrideSaving,
    overrideError,
    draggedEntryId,
    setDraggedEntryId,
    openGroupOverrideEditor,
    moveOverrideRow,
    saveGroupOverridesFromEditor,
  } = useTournamentGroupOverrideActions({
    db,
    eventId,
    format,
    config,
    enabledPhases,
    groupOverrides,
    setGroupOverrides,
    groupStandings,
  });

  const winnerSummaries = useMemo(
    () => buildTournamentWinnerSummaries({ matches, teams, pairs, config, format, groupStandings }),
    [matches, teams, pairs, config, format, groupStandings],
  );
  const { rankingColumns, rankingColumnLabel } = getTournamentRankingColumns(config, format);
  const activeLeaguePairs = pairs.filter(
    (pair) => pair.category === ui.activeCategory && pair.status !== 'withdrawn',
  );
  const unpairedLeagueParticipants = participants.filter(
    (participant) =>
      participant.category === ui.activeCategory &&
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
  const {
    leagueCourtModalOpen,
    setLeagueCourtModalOpen,
    leagueCourtSaving,
    leagueCourtDraft,
    setLeagueCourtDraft,
    leagueCourtSessionCount,
    setLeagueCourtSessionCount,
    leagueCourtError,
    leagueCourtConfirmation,
    setLeagueCourtConfirmation,
    courtTotal,
    leagueCourtWarnings,
    openLeagueCourtModal,
    moveLeaguePairToCourt,
    unassignLeaguePair,
    saveLeagueCourtAssignments,
  } = useLeagueEventCourtActions({
    db,
    eventId,
    courtCount,
    leaguePairs,
    leagueCourtAssignments,
    setLeagueCourtAssignments,
    setRegistrationRefresh: ui.setRegistrationRefresh,
    refreshPage: () => router.refresh(),
  });
  const withdrawEntry = ownEntries.find((entry) => entry.id === ui.withdrawTarget);
  const withdrawPair = withdrawEntry
    ? pairs.find(
        (pair) =>
          pair.status !== 'withdrawn' &&
          pair.category === withdrawEntry.category &&
          (pair.player_one_id === withdrawEntry.id || pair.player_two_id === withdrawEntry.id),
      )
    : undefined;
  const withdrawPairPayment = withdrawPair
    ? pairPaymentStatuses.find((status) => status.pair_id === withdrawPair.id)
    : undefined;
  const withdrawEitherPartnerPaid =
    !!withdrawPairPayment &&
    ['paid', 'not_required'].some((status) =>
      [
        withdrawPairPayment.player_one_payment_status,
        withdrawPairPayment.player_two_payment_status,
      ].includes(status),
    );
  const withdrawPaidTeam = Boolean(
    withdrawEntry?.confirmation_status === 'confirmed' &&
    withdrawEntry.partner_confirmation_status === 'confirmed' &&
    withdrawEitherPartnerPaid,
  );
  return (
    <section className={leagueTournament ? 'space-y-8' : 'space-y-5'}>
      <FloatingFeedback error={ui.registrationError} message={ui.registrationMessage} />
      {(canViewCompetition || !!adminContent) && (
        <>
          <TournamentPublicViewControls
            resultsOnly={resultsOnly}
            winnerSummaries={winnerSummaries}
            rankingsControl={rankingsControl}
            hasRules={hasRules}
            leagueTournament={leagueTournament}
            hasAdminContent={!!adminContent}
            tab={ui.tab}
            setTab={ui.setTab}
            activeCategory={ui.activeCategory}
            setActiveCategory={ui.setActiveCategory}
            format={format}
            config={config}
            onAssignCourts={openLeagueCourtModal}
          />
          <TournamentGroupOverrideDialog
            editor={overrideEditor}
            setEditor={setOverrideEditor}
            reason={overrideReason}
            setReason={setOverrideReason}
            saving={overrideSaving}
            error={overrideError}
            draggedEntryId={draggedEntryId}
            setDraggedEntryId={setDraggedEntryId}
            moveRow={moveOverrideRow}
            onSave={() => void saveGroupOverridesFromEditor()}
          />
          {['participants', 'matches', 'audit'].includes(ui.tab) &&
          adminContent &&
          (!leagueTournament || !['matches', 'audit'].includes(ui.tab)) ? (
            adminContent
          ) : loading ? (
            <div className="py-6">
              <TennisLoader label="Loading tournament details" />
            </div>
          ) : ui.tab === 'rules' && hasRules ? (
            <section className="rounded-lg border border-border p-4" aria-label="Tournament rules">
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(rulesHtml) }}
              />
            </section>
          ) : ui.tab === 'overview' ? (
            <TournamentOverviewPanel
              ui={ui}
              view={{
                eventDescription,
                genderRestriction,
                locationQuery,
                startsAt,
                endsAt,
                registrationOpensAt,
                registrationClosesAt,
                priceCents,
                canViewCompetition,
                format,
                teams,
                participants,
                pairs,
                leagueTournament,
                activeLeaguePairs,
                leaguePairs,
                leagueCourtAssignments,
                matches,
                unpairedLeagueParticipants,
                courtTotal,
                leagueTimeSlots,
                leagueScheduledMatches,
                ownTeamIds,
                ownParticipantIds,
                isOwnPair,
                winnerSummaries,
                isEventGuest,
                registrationOpen,
                ownEntries,
                leagueRegistrationCategory,
                loading,
                currentUserId,
                ownLeagueTeamId,
                registerLeagueTeam,
                availableCategories,
                requestEventGuestAccess,
                confirmPartnerParticipation,
                currentUserName,
                currentUserEmail,
                eventSlug,
                eventId,
                pairPaymentStatuses,
                hasGenderEligibleCategory,
                canManageLeagueScores,
                interacRequests,
                interacEnabled,
                tournamentPaymentActionKey,
                startTournamentPayment,
                saveOwnEventDetails,
                savePartnerChange,
                switchToSingle,
                config,
                submitRegistration,
                registrationModeConfig,
                effectiveRegistrationMode,
                partnerMembers,
                registrationGender,
                allowNonMemberRegistration,
                ownNextMatch,
                saveLeagueScore,
              }}
            />
          ) : (
            <TournamentCompetitionResults
              leagueTournament={leagueTournament}
              leagueStandingsBefore={leagueStandingsBefore}
              leagueStandingsAfter={leagueStandingsAfter}
              leagueHasResults={leagueHasResults}
              knockoutMatches={knockoutMatches}
              bracketStageLabel={bracketStageLabel}
              bracketSideLabel={bracketSideLabel}
              categoryVisibleMatches={categoryVisibleMatches}
              format={format}
              activeCategory={ui.activeCategory}
              groupStandings={groupStandings}
              rankingColumns={rankingColumns}
              rankingColumnLabel={rankingColumnLabel}
              isOwnCompetitionEntry={isOwnCompetitionEntry}
              groupOverrides={groupOverrides}
              enabledPhases={enabledPhases}
              config={config}
              hasAdminContent={!!adminContent}
              openGroupOverrideEditor={openGroupOverrideEditor}
              resultsOnly={resultsOnly}
              competitionMatchGrouping={ui.competitionMatchGrouping}
              setCompetitionMatchGrouping={ui.setCompetitionMatchGrouping}
              participants={participants}
              teams={teams}
              currentUserId={currentUserId}
              matchPlayers={matchPlayers}
              saveCaptainPairing={saveCaptainPairing}
              saveCaptainScore={saveCaptainScore}
              isOwnPair={isOwnPair}
              ownTeamIds={ownTeamIds}
              roundRobinRoundByMatch={roundRobinRoundByMatch}
            />
          )}
        </>
      )}
      <TournamentPublicViewDialogs
        court={{
          leagueCourtModalOpen,
          setLeagueCourtModalOpen,
          leagueCourtSaving,
          leagueCourtDraft,
          setLeagueCourtDraft,
          leagueCourtSessionCount,
          setLeagueCourtSessionCount,
          leagueCourtError,
          leagueCourtConfirmation,
          setLeagueCourtConfirmation,
          courtTotal,
          leagueCourtWarnings,
          openLeagueCourtModal,
          moveLeaguePairToCourt,
          unassignLeaguePair,
          saveLeagueCourtAssignments,
          leaguePairs,
        }}
        leagueWithdrawTarget={ui.leagueWithdrawTarget}
        leagueWithdrawError={ui.leagueWithdrawError}
        leagueWithdrawBusy={ui.leagueWithdrawBusy}
        setLeagueWithdrawTarget={ui.setLeagueWithdrawTarget}
        setLeagueWithdrawError={ui.setLeagueWithdrawError}
        confirmLeagueTeamWithdrawal={confirmLeagueTeamWithdrawal}
        withdrawTarget={ui.withdrawTarget}
        withdrawEntry={withdrawEntry}
        withdrawPaidTeam={withdrawPaidTeam}
        withdrawError={ui.withdrawError}
        withdrawBusy={ui.withdrawBusy}
        setWithdrawTarget={ui.setWithdrawTarget}
        setWithdrawError={ui.setWithdrawError}
        confirmTournamentWithdrawal={confirmTournamentWithdrawal}
        interacNotice={ui.interacNotice}
        setInteracNotice={ui.setInteracNotice}
      />
    </section>
  );
}
