'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { AssignmentDropZone, DraggableItem } from '@/components/drag-drop';

export type LeagueCourtAssignment = {
  pair_id: string;
  court_number: number;
  segment_order: number;
};

type LeaguePair = {
  id: string;
  player_one_name: string;
  player_two_name: string;
};

type LeagueCourtAssignmentDialogProps = {
  courtSessionCount: number;
  courtTotal: number;
  leaguePairs: LeaguePair[];
  leagueCourtDraft: LeagueCourtAssignment[];
  leagueCourtSaving: boolean;
  leagueCourtError: string;
  setLeagueCourtDraft: Dispatch<SetStateAction<LeagueCourtAssignment[]>>;
  setLeagueCourtSessionCount: Dispatch<SetStateAction<number>>;
  onClose: () => void;
  onMoveLeaguePairToCourt: (pairId: string, court: number, session: number) => void;
  onUnassignLeaguePair: (pairId: string, session: number) => void;
  onSaveLeagueCourtAssignments: () => void;
};

export function LeagueCourtAssignmentDialog({
  courtSessionCount,
  courtTotal,
  leaguePairs,
  leagueCourtDraft,
  leagueCourtSaving,
  leagueCourtError,
  setLeagueCourtDraft,
  setLeagueCourtSessionCount,
  onClose,
  onMoveLeaguePairToCourt,
  onUnassignLeaguePair,
  onSaveLeagueCourtAssignments,
}: LeagueCourtAssignmentDialogProps) {
  const [draggingPairId, setDraggingPairId] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="league-assign-courts-title"
    >
      <div className="my-4 w-full max-w-6xl rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="league-assign-courts-title" className="text-xl font-semibold">
              Assign courts
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Drag each League team to a court or back to Unassigned teams. Each team uses two
              player places.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>
        <div className="mt-5 space-y-6">
          {Array.from({ length: courtSessionCount }, (_, index) => index + 1).map((session) => (
            <section key={session} className="rounded-lg border border-border p-3">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Sub-session {session}</h3>
                {session > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setLeagueCourtDraft((current) =>
                        current
                          .filter((item) => item.segment_order !== session)
                          .map((item) => ({
                            ...item,
                            segment_order:
                              item.segment_order > session
                                ? item.segment_order - 1
                                : item.segment_order,
                          })),
                      );
                      setLeagueCourtSessionCount((count) => count - 1);
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    Remove sub-session
                  </button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: courtTotal }, (_, index) => index + 1).map((court) => {
                  const assigned = leagueCourtDraft.filter(
                    (item) => item.segment_order === session && item.court_number === court,
                  );
                  return (
                    <AssignmentDropZone
                      variant="court"
                      key={court}
                      onDrop={(event) => {
                        const pairId = event.dataTransfer.getData('application/x-pctc-league-pair');
                        if (pairId) onMoveLeaguePairToCourt(pairId, court, session);
                      }}
                    >
                      <h4 className="mb-3 text-sm font-semibold">
                        Court {court}{' '}
                        <span className="font-normal text-muted-foreground">
                          ({assigned.length} teams / {assigned.length * 2} player places)
                        </span>
                      </h4>
                      <div className="space-y-2">
                        {assigned.map((assignment) => {
                          const pair = leaguePairs.find((item) => item.id === assignment.pair_id);
                          if (!pair) return null;
                          return (
                            <DraggableItem
                              key={assignment.pair_id}
                              id={assignment.pair_id}
                              dataType="application/x-pctc-league-pair"
                              appearance="assignment"
                              onDragStateChange={setDraggingPairId}
                              className={`shadow-sm ${draggingPairId === assignment.pair_id ? 'opacity-50' : ''}`}
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {pair.player_one_name} + {pair.player_two_name}
                                </p>
                                <p className="text-xs text-muted-foreground">Two player places</p>
                              </div>
                            </DraggableItem>
                          );
                        })}
                      </div>
                    </AssignmentDropZone>
                  );
                })}
              </div>
              <AssignmentDropZone
                variant="unassigned"
                onDrop={(event) => {
                  const pairId = event.dataTransfer.getData('application/x-pctc-league-pair');
                  if (pairId) onUnassignLeaguePair(pairId, session);
                }}
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Unassigned teams
                </p>
                <div className="flex flex-wrap gap-2">
                  {leaguePairs
                    .filter(
                      (pair) =>
                        !leagueCourtDraft.some(
                          (item) => item.pair_id === pair.id && item.segment_order === session,
                        ),
                    )
                    .map((pair) => (
                      <DraggableItem
                        key={pair.id}
                        id={pair.id}
                        dataType="application/x-pctc-league-pair"
                        appearance="assignment"
                        onDragStateChange={setDraggingPairId}
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {pair.player_one_name} + {pair.player_two_name}
                          </p>
                          <p className="text-xs text-muted-foreground">Two player places</p>
                        </div>
                      </DraggableItem>
                    ))}
                  {!leaguePairs.length && (
                    <p className="text-sm text-muted-foreground">No paired League teams yet.</p>
                  )}
                </div>
              </AssignmentDropZone>
            </section>
          ))}
          <button
            type="button"
            onClick={() => {
              const next = courtSessionCount + 1;
              const copied = leagueCourtDraft
                .filter((item) => item.segment_order === 1)
                .map((item) => ({ ...item, segment_order: next }));
              setLeagueCourtDraft((current) => [...current, ...copied]);
              setLeagueCourtSessionCount(next);
            }}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Add sub-session
          </button>
        </div>
        {leagueCourtError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {leagueCourtError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={leagueCourtSaving}
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={leagueCourtSaving || !leaguePairs.length}
            onClick={onSaveLeagueCourtAssignments}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {leagueCourtSaving ? 'Saving…' : 'Save assignments'}
          </button>
        </div>
      </div>
    </div>
  );
}
