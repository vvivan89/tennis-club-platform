'use client';
import { useEffect, useMemo, useState } from 'react';
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
import { hasSingleTournamentGroup } from '@/lib/tournament-groups';
import { getTournamentPublicRegistrationState } from '@/components/tournament-public-registration-state';
import { useTournamentPublicViewData } from '@/components/use-tournament-public-view-data';
import { useTournamentCaptainActions } from '@/components/use-tournament-captain-actions';
import { useLeagueEventScoreActions } from '@/components/use-league-event-score-actions';
import { useTournamentPaymentAction } from '@/components/use-tournament-payment-action';
import { useTournamentVisibleMatchData } from '@/components/use-tournament-visible-match-data';
import { useTournamentPublicViewSubscriptions } from '@/components/use-tournament-public-view-subscriptions';
import { useTournamentMatchLineupRefresh } from '@/components/use-tournament-match-lineup-refresh';
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
import { TournamentEventSummary } from '@/components/tournament-event-summary';
import { buildTournamentGroupStandings } from '@/components/tournament-public-group-standings';
import { useTournamentGroupOverrideActions } from '@/components/use-tournament-group-override-actions';
import { useTournamentPublicViewUiState } from '@/components/use-tournament-public-view-ui-state';
import { useTournamentWinnerAnnouncement } from '@/components/use-tournament-winner-announcement';
import { getTournamentWithdrawalPaymentState } from '@/components/tournament-withdrawal-payment-state';
import { getTournamentLeagueOverviewData } from '@/components/tournament-league-overview-data';
const EMPTY_WINNER_SUMMARIES: Array<{ category: string; winners: string[] }> = [];
export function TournamentPublicView({
  adminContent = null,
  isManager = false,
  eventTitle = '',
  eventDescription = '',
  genderRestriction = null,
  eventSlug = '',
  eventId,
  currentUserId,
  currentUserEmail = null,
  currentUserAccountKind = 'member',
  currentUserIsApprovedMember = false,
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
  winnersAnnounced: initialWinnersAnnounced = false,
  announcedWinners: initialAnnouncedWinners = EMPTY_WINNER_SUMMARIES,
}: TournamentPublicViewProps) {
  const db = useMemo(() => createSupabaseBrowserClient(), []),
    router = useRouter();
  useEffect(() => {
    if (eventTitle) document.title = `PCTC | ${eventTitle}`;
  }, [eventTitle]);
  const hasRules = Boolean(rulesHtml?.trim()) && !leagueTournament;
  const isEventGuest = !!currentUserId && currentUserAccountKind === 'event_guest';
  const canManageLeagueScores = leagueTournament && Boolean(adminContent);
  const [captainRequestBusy, setCaptainRequestBusy] = useState(false);
  const [captainAssignmentBusy, setCaptainAssignmentBusy] = useState(false);
  const [captainActionMessage, setCaptainActionMessage] = useState('');
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
    setParticipants,
    partnerMembers,
    pairPaymentStatuses,
    pairs,
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
  const requestCaptain = async (participantId: string) => {
    setCaptainRequestBusy(true);
    ui.setRegistrationError('');
    ui.setRegistrationMessage('');
    try {
      const { error } = await db.rpc('request_tournament_captain', {
        p_participant_id: participantId,
      });
      if (error) {
        ui.setRegistrationError(error.message);
      } else {
        setOwnEntries((current) =>
          current.map((entry) =>
            entry.id === participantId ? { ...entry, captain_requested: true } : entry,
          ),
        );
        ui.setRegistrationMessage('Your captain request was sent to the tournament organizer.');
      }
    } catch {
      ui.setRegistrationError('Could not send the captain request. Please try again.');
    } finally {
      setCaptainRequestBusy(false);
    }
  };
  const assignUnassignedPlayer = async (participantId: string) => {
    setCaptainAssignmentBusy(true);
    ui.setRegistrationError('');
    ui.setRegistrationMessage('');
    try {
      const { data: teamId, error } = await db.rpc('assign_tournament_player_to_captain_team', {
        p_participant_id: participantId,
      });
      if (error) throw new Error(error.message);
      setParticipants((current) =>
        current.map((participant) =>
          participant.id === participantId ? { ...participant, team_id: teamId } : participant,
        ),
      );
      ui.setRegistrationMessage('Player added to your team roster.');
    } catch (error) {
      ui.setRegistrationError(
        error instanceof Error ? error.message : 'Could not add this player to your team.',
      );
    } finally {
      setCaptainAssignmentBusy(false);
    }
  };
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
  useTournamentMatchLineupRefresh({
    matches,
    eventStartsAt: startsAt,
    setRegistrationRefresh: ui.setRegistrationRefresh,
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
    config,
    eventStartsAt: startsAt,
    setMatchPlayers,
    setMatches,
    setActionMessage: setCaptainActionMessage,
    setSuccessMessage: ui.setRegistrationMessage,
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
    createTournamentBracketLabels({
      format,
      knockoutMatches,
      teams,
      pairs,
      singleGroup: hasSingleTournamentGroup(config),
    });
  const {
    canViewCompetition,
    isTeamCaptain,
    captainOnlyView,
    leagueRegistrationCategory,
    registrationGender,
    hasGenderEligibleCategory,
    availableCategories,
    registrationOpen,
    registrationModeConfig,
    effectiveRegistrationMode,
  } = getTournamentPublicRegistrationState({
    detailsPublic,
    currentUserIsApprovedMember,
    currentUserId,
    ownParticipantCount: ownParticipantIds.length,
    format,
    leagueTournament,
    teams,
    isManager,
    leagueGender,
    isEventGuest,
    entrantGender: ui.entrantGender,
    profileGender,
    config,
    ownCategories,
    eventStatus,
    registrationOpensAt,
    registrationClosesAt,
    startsAt,
    registrationMode: ui.registrationMode,
  });
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
  const groupOverrideActions = useTournamentGroupOverrideActions({
    db,
    eventId,
    format,
    config,
    enabledPhases,
    groupOverrides,
    setGroupOverrides,
    groupStandings,
  });
  const { openGroupOverrideEditor } = groupOverrideActions;

  const {
    winnerSummaries,
    visibleWinnerSummaries,
    winnersAnnounced,
    allScheduledMatchesPlayed,
    announcementFeedback,
    toggleWinnerAnnouncement,
  } = useTournamentWinnerAnnouncement({
    db,
    eventId,
    isManager,
    initialWinnersAnnounced,
    initialAnnouncedWinners,
    matches,
    teams,
    pairs,
    config,
    format,
    groupStandings,
  });
  const { rankingColumns, rankingColumnLabel } = getTournamentRankingColumns(config, format);
  const {
    activeLeaguePairs,
    unpairedLeagueParticipants,
    leagueScheduledMatches,
    leagueTimeSlots,
    leaguePairs,
  } = getTournamentLeagueOverviewData(pairs, participants, matches, ui.activeCategory);
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
  const { withdrawEntry, withdrawPaidTeam } = getTournamentWithdrawalPaymentState(
    ui.withdrawTarget,
    ownEntries,
    pairs,
    pairPaymentStatuses,
  );
  return (
    <section className={leagueTournament ? 'space-y-8' : 'space-y-5'}>
      <FloatingFeedback
        error={ui.registrationError || announcementFeedback.error}
        message={ui.registrationMessage || announcementFeedback.message}
      />
      {!resultsOnly && (
        <TournamentEventSummary
          leagueTournament={leagueTournament}
          eventDescription={eventDescription}
          genderRestriction={genderRestriction}
          locationQuery={locationQuery}
          startsAt={startsAt}
          endsAt={endsAt}
          registrationOpensAt={registrationOpensAt}
          registrationClosesAt={registrationClosesAt}
          priceCents={priceCents}
        />
      )}
      {(canViewCompetition || !!adminContent || isTeamCaptain) && (
        <>
          <TournamentPublicViewControls
            resultsOnly={resultsOnly}
            winnerSummaries={visibleWinnerSummaries}
            adminWinnerPreview={winnerSummaries}
            isManager={isManager}
            allScheduledMatchesPlayed={allScheduledMatchesPlayed}
            winnersAnnounced={winnersAnnounced}
            announcementBusy={announcementFeedback.busy}
            onToggleWinnersAnnouncement={() => void toggleWinnerAnnouncement()}
            rankingsControl={rankingsControl}
            hasRules={hasRules}
            leagueTournament={leagueTournament}
            hasAdminContent={isManager}
            isTeamCaptain={isTeamCaptain}
            captainOnlyView={captainOnlyView}
            tab={ui.tab}
            setTab={ui.setTab}
            activeCategory={ui.activeCategory}
            setActiveCategory={ui.setActiveCategory}
            format={format}
            config={config}
            onAssignCourts={openLeagueCourtModal}
          />
          <TournamentGroupOverrideDialog {...groupOverrideActions.dialogProps} />
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
                winnerSummaries: visibleWinnerSummaries,
                isEventGuest,
                registrationOpen,
                ownEntries,
                leagueRegistrationCategory,
                loading,
                currentUserId,
                assignUnassignedPlayer,
                captainAssignmentBusy,
                ownLeagueTeamId,
                registerLeagueTeam,
                availableCategories,
                requestEventGuestAccess,
                confirmPartnerParticipation,
                currentUserName,
                currentUserEmail,
                currentUserPhone,
                currentUserGender,
                currentUserSkillLevel,
                currentUserIsApprovedMember,
                captainRequestBusy,
                requestCaptain,
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
              eventStartsAt={startsAt}
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
              hasAdminContent={isManager}
              openGroupOverrideEditor={openGroupOverrideEditor}
              resultsOnly={resultsOnly}
              competitionMatchGrouping={ui.competitionMatchGrouping}
              setCompetitionMatchGrouping={ui.setCompetitionMatchGrouping}
              participants={participants}
              pairs={pairs}
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
        captainActionMessage={captainActionMessage}
        clearCaptainActionMessage={() => setCaptainActionMessage('')}
      />
    </section>
  );
}
