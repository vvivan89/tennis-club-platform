'use client';

import type { Dispatch, SetStateAction } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LeagueCourtAssignmentDialog } from '@/components/league-court-assignment-dialog';
import {
  InteracPaymentInstructionsDialog,
  type InteracPaymentNotice,
} from '@/components/interac-payment-instructions-dialog';
import type { OwnTournamentEntry, Pair } from '@/components/tournament-public-view-types';
import type { useLeagueEventCourtActions } from '@/components/use-league-event-court-actions';

type CourtActions = ReturnType<typeof useLeagueEventCourtActions>;

export function TournamentPublicViewDialogs({
  court,
  leagueWithdrawTarget,
  leagueWithdrawError,
  leagueWithdrawBusy,
  setLeagueWithdrawTarget,
  setLeagueWithdrawError,
  confirmLeagueTeamWithdrawal,
  withdrawTarget,
  withdrawEntry,
  withdrawPaidTeam,
  withdrawError,
  withdrawBusy,
  setWithdrawTarget,
  setWithdrawError,
  confirmTournamentWithdrawal,
  interacNotice,
  setInteracNotice,
}: {
  court: Pick<
    CourtActions,
    | 'leagueCourtModalOpen'
    | 'setLeagueCourtModalOpen'
    | 'leagueCourtSaving'
    | 'leagueCourtDraft'
    | 'setLeagueCourtDraft'
    | 'leagueCourtSessionCount'
    | 'setLeagueCourtSessionCount'
    | 'leagueCourtError'
    | 'leagueCourtConfirmation'
    | 'setLeagueCourtConfirmation'
    | 'courtTotal'
    | 'leagueCourtWarnings'
    | 'openLeagueCourtModal'
    | 'moveLeaguePairToCourt'
    | 'unassignLeaguePair'
    | 'saveLeagueCourtAssignments'
  > & { leaguePairs: Pair[] };
  leagueWithdrawTarget: { participantId: string; partnerParticipantId: string } | null;
  leagueWithdrawError: string;
  leagueWithdrawBusy: boolean;
  setLeagueWithdrawTarget: Dispatch<
    SetStateAction<{ participantId: string; partnerParticipantId: string } | null>
  >;
  setLeagueWithdrawError: Dispatch<SetStateAction<string>>;
  confirmLeagueTeamWithdrawal: () => Promise<void>;
  withdrawTarget: string | null;
  withdrawEntry: OwnTournamentEntry | undefined;
  withdrawPaidTeam: boolean;
  withdrawError: string;
  withdrawBusy: boolean;
  setWithdrawTarget: Dispatch<SetStateAction<string | null>>;
  setWithdrawError: Dispatch<SetStateAction<string>>;
  confirmTournamentWithdrawal: () => Promise<void>;
  interacNotice: InteracPaymentNotice | null;
  setInteracNotice: Dispatch<SetStateAction<InteracPaymentNotice | null>>;
}) {
  return (
    <>
      {court.leagueCourtModalOpen && (
        <LeagueCourtAssignmentDialog
          courtSessionCount={court.leagueCourtSessionCount}
          courtTotal={court.courtTotal}
          leaguePairs={court.leaguePairs}
          leagueCourtDraft={court.leagueCourtDraft}
          leagueCourtSaving={court.leagueCourtSaving}
          leagueCourtError={court.leagueCourtError}
          setLeagueCourtDraft={court.setLeagueCourtDraft}
          setLeagueCourtSessionCount={court.setLeagueCourtSessionCount}
          onClose={() => court.setLeagueCourtModalOpen(false)}
          onMoveLeaguePairToCourt={court.moveLeaguePairToCourt}
          onUnassignLeaguePair={court.unassignLeaguePair}
          onSaveLeagueCourtAssignments={() => void court.saveLeagueCourtAssignments()}
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
      {withdrawTarget && withdrawEntry && (
        <ConfirmDialog
          open
          title="Withdraw this event registration?"
          description={
            <>
              <p>
                {withdrawPaidTeam
                  ? 'Withdrawing this paid team registration will withdraw the whole team.'
                  : 'This will withdraw your registration from the event.'}
              </p>
              {withdrawError && (
                <p role="alert" className="mt-3 text-destructive">
                  {withdrawError}
                </p>
              )}
            </>
          }
          confirmLabel="Confirm withdrawal"
          destructive
          busy={withdrawBusy}
          onCancel={() => {
            setWithdrawTarget(null);
            setWithdrawError('');
          }}
          onConfirm={() => void confirmTournamentWithdrawal()}
        />
      )}
      {court.leagueCourtConfirmation && (
        <ConfirmDialog
          open
          title="Court assignment warnings"
          description={`${court.leagueCourtWarnings
            .map(
              ({ session, court: courtNumber, count }) =>
                `Sub-session ${session}, Court ${courtNumber} has ${count} teams (${count * 2} player places; maximum 4).`,
            )
            .join('\n')}\n\nSave these assignments anyway?`}
          confirmLabel="Save anyway"
          busy={court.leagueCourtSaving}
          onCancel={() => court.setLeagueCourtConfirmation(false)}
          onConfirm={() => {
            court.setLeagueCourtConfirmation(false);
            void court.saveLeagueCourtAssignments(true);
          }}
        />
      )}
      <InteracPaymentInstructionsDialog
        notice={interacNotice}
        onClose={() => setInteracNotice(null)}
      />
    </>
  );
}
