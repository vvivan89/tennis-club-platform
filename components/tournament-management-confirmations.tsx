import { ConfirmDialog } from '@/components/confirm-dialog';

type Participant = { id: string; display_name: string };

export function TournamentManagementConfirmations({
  busy,
  scheduleConflictCount,
  courtMove,
  participant,
  walkoverPending,
  deletePending,
  onCancelSchedule,
  onConfirmSchedule,
  onCancelCourtMove,
  onConfirmCourtMove,
  onCancelParticipant,
  onConfirmParticipant,
  onCancelWalkover,
  onConfirmWalkover,
  onCancelDelete,
  onConfirmDelete,
}: {
  busy: boolean;
  scheduleConflictCount: number;
  courtMove: { court: number | null } | null;
  participant: Participant | null;
  walkoverPending: boolean;
  deletePending: boolean;
  onCancelSchedule: () => void;
  onConfirmSchedule: () => void;
  onCancelCourtMove: () => void;
  onConfirmCourtMove: () => void;
  onCancelParticipant: () => void;
  onConfirmParticipant: () => void;
  onCancelWalkover: () => void;
  onConfirmWalkover: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      <ConfirmDialog
        open={scheduleConflictCount > 0}
        title="Schedule conflict detected"
        description={`This change conflicts with ${scheduleConflictCount} other match(es) because of court or player availability. Move the conflicting matches forward automatically? Matches that cannot fit before the tournament ends will require manual adjustment.`}
        confirmLabel="Move conflicting matches"
        busy={busy}
        onCancel={onCancelSchedule}
        onConfirm={onConfirmSchedule}
      />
      <ConfirmDialog
        open={!!courtMove}
        title="Court schedule conflict detected"
        description={
          courtMove
            ? `Moving this match to Court ${courtMove.court} creates scheduling conflict. Save this court assignment anyway? Other matches will not be moved.`
            : ''
        }
        confirmLabel="Save assignment anyway"
        busy={busy}
        onCancel={onCancelCourtMove}
        onConfirm={onConfirmCourtMove}
      />
      <ConfirmDialog
        open={!!participant}
        title="Remove player from this category?"
        description={
          participant
            ? `Withdraw ${participant.display_name} from this category. Unplayed doubles matches involving their pair will be cancelled; completed match history will be preserved.`
            : ''
        }
        confirmLabel="Remove player"
        destructive
        busy={busy}
        onCancel={onCancelParticipant}
        onConfirm={onConfirmParticipant}
      />
      <ConfirmDialog
        open={walkoverPending}
        title="Replace walkover result?"
        description="This match has been awarded as a walkover or retirement. Saving these set scores will replace that result and remove the walkover notice. Continue?"
        confirmLabel="Save score"
        busy={busy}
        onCancel={onCancelWalkover}
        onConfirm={onConfirmWalkover}
      />
      <ConfirmDialog
        open={deletePending}
        title="Delete match?"
        description="Delete this match? This action can not be undone."
        confirmLabel="Delete match"
        destructive
        busy={busy}
        onCancel={onCancelDelete}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
