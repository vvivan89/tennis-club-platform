'use client';
import Link from 'next/link';
import { EventWeather } from '@/components/event-weather';
import { TennisLoader } from '@/components/tennis-loader';
import { LeagueEventScoreEntry } from '@/components/league-event-score-entry';
import { TournamentOverviewParticipants } from '@/components/tournament-overview-participants';
import { TournamentPartnerConfirmation } from '@/components/tournament-partner-confirmation';
import { TournamentOwnRegistrationList } from '@/components/tournament-own-registration-list';
import { TournamentRegistrationStatus } from '@/components/tournament-registration-status';
import { TournamentEntryForm } from '@/components/tournament-entry-form';
import { dateLabel } from '@/components/tournament-public-view-format';
import { UserIdentity } from '@/components/user-identity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TournamentOverviewPanel({ view, ui }: { view: any; ui: any }) {
  const {
    locationQuery,
    startsAt,
    endsAt,
    registrationClosesAt,
    priceCents,
    canViewCompetition,
    format,
    teams,
    activeCategory,
    participants,
    pairs,
    leagueTournament,
    leagueCourtView,
    setLeagueCourtView,
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
    tab,
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
    guestAccessVisible,
    setGuestAccessVisible,
    requestEventGuestAccess,
    guestAccessBusy,
    guestAccessEmail,
    setGuestAccessEmail,
    guestAccessMessage,
    guestAccessError,
    partnerConfirmation,
    partnerConfirmationError,
    partnerConfirmationBusy,
    confirmPartnerParticipation,
    currentUserName,
    currentUserEmail,
    currentUserPhone,
    currentUserGender,
    currentUserSkillLevel,
    currentUserIsApprovedMember,
    captainRequestBusy,
    requestCaptain,
    interacRequests,
    interacEnabled,
    paymentBusy,
    paymentBusyKey,
    tournamentPaymentActionKey,
    startTournamentPayment,
    setInteracNotice,
    setOwnEditTarget,
    setOwnEditName,
    setOwnEditPhone,
    setOwnEditGender,
    setOwnEditSkill,
    ownEditTarget,
    ownEditName,
    ownEditPhone,
    ownEditGender,
    ownEditSkill,
    ownEditBusy,
    saveOwnEventDetails,
    setPartnerEditTarget,
    setPartnerEditName,
    setPartnerEditEmail,
    setPartnerEditPhone,
    setPartnerEditGender,
    setPartnerEditSkill,
    partnerEditTarget,
    partnerEditName,
    partnerEditEmail,
    partnerEditPhone,
    partnerEditGender,
    partnerEditSkill,
    partnerEditBusy,
    savePartnerChange,
    switchToSingle,
    config,
    leagueWithdrawBusy,
    setRegistrationError,
    setLeagueWithdrawTarget,
    setLeagueWithdrawError,
    setWithdrawError,
    setWithdrawTarget,
    submitRegistration,
    registrationCategory,
    setRegistrationCategory,
    setPartnerChoice,
    registrationModeConfig,
    registrationMode,
    setRegistrationMode,
    entrantName,
    setEntrantName,
    entrantEmail,
    entrantPhone,
    setEntrantPhone,
    entrantSkillLevel,
    setEntrantSkillLevel,
    entrantGender,
    setEntrantGender,
    effectiveRegistrationMode,
    partnerChoice,
    partnerMembers,
    registrationGender,
    allowNonMemberRegistration,
    partnerName,
    setPartnerName,
    partnerEmail,
    setPartnerEmail,
    partnerPhone,
    setPartnerPhone,
    partnerSkillLevel,
    setPartnerSkillLevel,
    partnerGender,
    setPartnerGender,
    pairPaymentStatuses,
    eventSlug,
    eventId,
    hasGenderEligibleCategory,
    canManageLeagueScores,
    newEntryParticipantId,
    newPartnerParticipantId,
    paymentParticipantIds,
    ownNextMatch,
    leagueEventStarted,
    leagueScoresOpen,
    leagueScoreMatchId,
    setLeagueScoreMatchId,
    leagueScoreTeamSide,
    setLeagueScoreTeamSide,
    leagueScoreDrafts,
    setLeagueScoreDrafts,
    savingLeagueScore,
    saveLeagueScore,
  } = { ...view, ...ui };
  const registrationBusy = ui.registrationBusy;
  const renderPairIdentity = (pairId: string | null, fallback: string) => {
    const pair = pairs.find((item: { id: string }) => item.id === pairId);
    if (!pair) return fallback;
    const renderPlayer = (id: string, name: string, skill?: number | null) => {
      const player = participants.find((item: { id: string }) => item.id === id);
      return (
        <UserIdentity
          name={player?.display_name ?? name}
          skillLevel={player?.tennis_skill_level ?? skill}
          avatarUrl={player?.avatar_url}
          birthdayVisible={player?.birthday_emoji_visible}
          compact
        />
      );
    };
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {renderPlayer(pair.player_one_id, pair.player_one_name, pair.player_one_skill_level)} +{' '}
        {renderPlayer(pair.player_two_id, pair.player_two_name, pair.player_two_skill_level)}
      </span>
    );
  };
  return (
    <div className={leagueTournament ? 'flex flex-col gap-5' : 'space-y-5'}>
      <TournamentOverviewParticipants
        canViewCompetition={canViewCompetition}
        format={format}
        teams={teams}
        activeCategory={activeCategory}
        participants={participants}
        pairs={pairs}
        leagueTournament={leagueTournament}
        leagueCourtView={leagueCourtView}
        setLeagueCourtView={setLeagueCourtView}
        activeLeaguePairs={activeLeaguePairs}
        leaguePairs={leaguePairs}
        leagueCourtAssignments={leagueCourtAssignments}
        matches={matches}
        unpairedLeagueParticipants={unpairedLeagueParticipants}
        courtTotal={courtTotal}
        leagueTimeSlots={leagueTimeSlots}
        leagueScheduledMatches={leagueScheduledMatches}
        ownTeamIds={ownTeamIds}
        ownParticipantIds={ownParticipantIds}
        isOwnPair={isOwnPair}
        currentUserId={currentUserId}
        assignUnassignedPlayer={assignUnassignedPlayer}
        captainAssignmentBusy={captainAssignmentBusy}
      />
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
          id="registration"
          className={
            leagueTournament
              ? 'order-3 scroll-mt-24 rounded-xl border border-border p-5'
              : 'scroll-mt-24 rounded-lg border border-border p-4'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className={leagueTournament ? 'text-xl font-semibold' : 'font-semibold'}>
              {leagueTournament ? 'Registration' : 'Tournament registration'}
            </h3>
            {leagueTournament &&
              registrationOpen &&
              !ownEntries.some(
                (entry: { category: string }) => entry.category === leagueRegistrationCategory,
              ) &&
              !loading &&
              currentUserId &&
              ownLeagueTeamId && (
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
              )}
            {isEventGuest && (
              <Link href="/my-events" className="text-sm font-medium text-primary underline">
                My events
              </Link>
            )}
          </div>
          <TournamentPartnerConfirmation
            confirmation={partnerConfirmation}
            error={partnerConfirmationError}
            busy={partnerConfirmationBusy}
            onConfirm={() => void confirmPartnerParticipation()}
          />
          <TournamentOwnRegistrationList
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserEmail={currentUserEmail}
            currentUserPhone={currentUserPhone}
            currentUserGender={currentUserGender}
            currentUserSkillLevel={currentUserSkillLevel}
            isEventGuest={isEventGuest}
            ownEntries={ownEntries}
            teams={teams}
            canRequestCaptain={currentUserIsApprovedMember}
            captainRequestBusy={captainRequestBusy}
            requestCaptain={requestCaptain}
            pairs={pairs}
            pairPaymentStatuses={pairPaymentStatuses}
            registrationClosesAt={registrationClosesAt}
            startsAt={startsAt}
            interacRequests={interacRequests}
            interacEnabled={interacEnabled}
            paymentBusy={paymentBusy}
            partnerConfirmationBusy={partnerConfirmationBusy}
            confirmPartnerParticipation={confirmPartnerParticipation}
            paymentBusyKey={paymentBusyKey}
            paymentActionKey={tournamentPaymentActionKey}
            startTournamentPayment={startTournamentPayment}
            setInteracNotice={setInteracNotice}
            setOwnEditTarget={setOwnEditTarget}
            setOwnEditName={setOwnEditName}
            setOwnEditPhone={setOwnEditPhone}
            setOwnEditGender={setOwnEditGender}
            setOwnEditSkill={setOwnEditSkill}
            ownEditTarget={ownEditTarget}
            ownEditName={ownEditName}
            ownEditPhone={ownEditPhone}
            ownEditGender={ownEditGender}
            ownEditSkill={ownEditSkill}
            ownEditBusy={ownEditBusy}
            saveOwnEventDetails={saveOwnEventDetails}
            setPartnerEditTarget={setPartnerEditTarget}
            setPartnerEditName={setPartnerEditName}
            setPartnerEditEmail={setPartnerEditEmail}
            setPartnerEditPhone={setPartnerEditPhone}
            setPartnerEditGender={setPartnerEditGender}
            setPartnerEditSkill={setPartnerEditSkill}
            partnerEditTarget={partnerEditTarget}
            partnerEditName={partnerEditName}
            partnerEditEmail={partnerEditEmail}
            partnerEditPhone={partnerEditPhone}
            partnerEditGender={partnerEditGender}
            partnerEditSkill={partnerEditSkill}
            partnerEditBusy={partnerEditBusy}
            savePartnerChange={savePartnerChange}
            switchToSingle={switchToSingle}
            format={format}
            config={config}
            leagueTournament={leagueTournament}
            leagueWithdrawBusy={leagueWithdrawBusy}
            setRegistrationError={setRegistrationError}
            setLeagueWithdrawTarget={setLeagueWithdrawTarget}
            setLeagueWithdrawError={setLeagueWithdrawError}
            setWithdrawError={setWithdrawError}
            setWithdrawTarget={setWithdrawTarget}
          />
          <TournamentRegistrationStatus
            priceCents={priceCents}
            registrationOpen={registrationOpen}
            currentUserId={currentUserId}
            allowNonMemberRegistration={allowNonMemberRegistration}
            eventSlug={eventSlug}
            eventId={eventId}
            guestAccessVisible={guestAccessVisible}
            setGuestAccessVisible={setGuestAccessVisible}
            requestEventGuestAccess={requestEventGuestAccess}
            guestAccessBusy={guestAccessBusy}
            guestAccessEmail={guestAccessEmail}
            setGuestAccessEmail={setGuestAccessEmail}
            guestAccessMessage={guestAccessMessage}
            guestAccessError={guestAccessError}
            leagueTournament={leagueTournament}
            ownLeagueTeamId={ownLeagueTeamId}
            ownEntries={ownEntries}
            leagueRegistrationCategory={leagueRegistrationCategory}
            availableCategories={availableCategories}
            hasGenderEligibleCategory={hasGenderEligibleCategory}
          >
            <TournamentEntryForm
              submitRegistration={submitRegistration}
              leagueTournament={leagueTournament}
              registrationCategory={registrationCategory}
              availableCategories={availableCategories}
              setRegistrationCategory={setRegistrationCategory}
              setPartnerChoice={setPartnerChoice}
              registrationModeConfig={registrationModeConfig}
              registrationMode={registrationMode}
              setRegistrationMode={setRegistrationMode}
              isEventGuest={isEventGuest}
              entrantName={entrantName}
              setEntrantName={setEntrantName}
              entrantEmail={entrantEmail}
              entrantPhone={entrantPhone}
              setEntrantPhone={setEntrantPhone}
              entrantSkillLevel={entrantSkillLevel}
              setEntrantSkillLevel={setEntrantSkillLevel}
              entrantGender={entrantGender}
              setEntrantGender={setEntrantGender}
              format={format}
              effectiveRegistrationMode={effectiveRegistrationMode}
              currentUserId={currentUserId}
              partnerChoice={partnerChoice}
              partnerMembers={partnerMembers}
              registrationGender={registrationGender}
              allowNonMemberRegistration={allowNonMemberRegistration}
              partnerName={partnerName}
              setPartnerName={setPartnerName}
              partnerEmail={partnerEmail}
              setPartnerEmail={setPartnerEmail}
              partnerPhone={partnerPhone}
              setPartnerPhone={setPartnerPhone}
              partnerSkillLevel={partnerSkillLevel}
              setPartnerSkillLevel={setPartnerSkillLevel}
              partnerGender={partnerGender}
              setPartnerGender={setPartnerGender}
              participants={participants}
              registrationBusy={registrationBusy}
            />
          </TournamentRegistrationStatus>
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
                      [newEntryParticipantId, newPartnerParticipantId].filter((id): id is string =>
                        Boolean(id),
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
            {format === 'team' ? (
              `${ownNextMatch.team_one_name || 'TBD'} vs ${ownNextMatch.team_two_name || 'TBD'}`
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                {renderPairIdentity(
                  ownNextMatch.pair_one_id,
                  ownNextMatch.player_one_name || 'TBD',
                )}
                vs
                {renderPairIdentity(
                  ownNextMatch.pair_two_id,
                  ownNextMatch.opponent_one_name || 'TBD',
                )}
              </span>
            )}
          </p>
          <p className="mt-1 text-sm">
            {ownNextMatch.status === 'bye'
              ? 'BYE — automatic advancement'
              : `${dateLabel(ownNextMatch.scheduled_at)}${ownNextMatch.court_number ? ` · Court ${ownNextMatch.court_number}` : ''}`}
          </p>
        </div>
      )}
      {leagueTournament && (
        <LeagueEventScoreEntry
          matches={matches}
          pairs={pairs}
          currentUserId={currentUserId}
          canManageLeagueScores={canManageLeagueScores}
          leagueEventStarted={leagueEventStarted}
          leagueScoresOpen={leagueScoresOpen}
          leagueScoreMatchId={leagueScoreMatchId}
          setLeagueScoreMatchId={setLeagueScoreMatchId}
          leagueScoreTeamSide={leagueScoreTeamSide}
          setLeagueScoreTeamSide={setLeagueScoreTeamSide}
          leagueScoreDrafts={leagueScoreDrafts}
          setLeagueScoreDrafts={setLeagueScoreDrafts}
          savingLeagueScore={savingLeagueScore}
          saveLeagueScore={saveLeagueScore}
          isOwnPair={isOwnPair}
        />
      )}
    </div>
  );
}
