'use client';

import { UserIdentity } from '@/components/user-identity';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { TennisLoader } from '@/components/tennis-loader';
import { AssignmentDropZone, DraggableItem } from '@/components/drag-drop';

type Participant = {
  registration_id: string;
  user_id: string;
  status: string;
  full_name: string;
  avatar_url: string | null;
  tennis_skill_level: number | null;
  birthday_emoji_visible?: boolean;
};
type Session = Record<number, string[]>;
type RecordLine = { wins: number; losses: number };
type LadderStanding = { userId: string; name: string; points: number | null };

export function EventCourtAssignmentDialog({
  modalOpen,
  busy,
  ladderConfig,
  ladderStandings,
  sessions,
  setSessions,
  dragging,
  setDragging,
  participants,
  records,
  onClose,
  onAssignLadder,
  onMovePlayer,
  onAddSession,
  onSave,
}: {
  modalOpen: boolean;
  busy: boolean;
  ladderConfig: boolean;
  ladderStandings: LadderStanding[];
  sessions: Session[];
  setSessions: Dispatch<SetStateAction<Session[]>>;
  dragging: string | null;
  setDragging: Dispatch<SetStateAction<string | null>>;
  participants: Participant[];
  records: Record<string, RecordLine>;
  onClose: () => void;
  onAssignLadder: () => void;
  onMovePlayer: (participantId: string, court: number, sessionIndex: number) => void;
  onAddSession: () => void;
  onSave: () => void;
}) {
  return (
    <>
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-courts-title"
        >
          <div className="my-4 w-full max-w-6xl rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="assign-courts-title" className="text-xl font-semibold">
                  Assign courts
                </h2>
                <p className="text-sm text-muted-foreground">
                  Drag each player chip to a court. Every confirmed player must be assigned once in
                  each sub-session.
                </p>
              </div>
              {ladderConfig && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onAssignLadder()}
                >
                  Automatic ladder assignment
                </Button>
              )}
              <Button variant="outline" onClick={() => onClose()}>
                Close
              </Button>
            </div>
            {ladderConfig && ladderStandings.length > 0 && (
              <section className="mt-5 rounded-lg border border-border p-3">
                <h3 className="font-semibold">Current ladder ranking for registered players</h3>
                <ol className="mt-2 space-y-1 text-sm">
                  {ladderStandings.map((player, index) => (
                    <li key={player.userId} className="flex justify-between gap-3">
                      <span>
                        {index + 1}. {player.name}
                        {player.points === null ? ' · Unranked' : ''}
                      </span>
                      <span>{player.points === null ? '—' : `${player.points} pts`}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <div className="mt-5 space-y-6">
              {sessions.map((session, si) => (
                <section key={si} className="rounded-lg border border-border p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Sub-session {si + 1}</h3>
                    {sessions.length > 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSessions((old) => old.filter((_, i) => i !== si))}
                      >
                        Remove sub-session
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[1, 2, 3, 4].map((court) => (
                      <AssignmentDropZone
                        variant="court"
                        key={court}
                        onDrop={() => {
                          if (dragging) onMovePlayer(dragging, court, si);
                        }}
                      >
                        <h4 className="mb-3 text-sm font-semibold">
                          Court {court}{' '}
                          <span className="font-normal text-muted-foreground">
                            ({session[court].length}/4)
                          </span>
                        </h4>
                        <div className="space-y-2">
                          {session[court].map((id) => {
                            const p = participants.find((x) => x.registration_id === id);
                            if (!p) return null;
                            return (
                              <DraggableItem
                                key={id}
                                id={id}
                                appearance="assignment"
                                onDragStateChange={setDragging}
                                className="shadow-sm"
                              >
                                <div className="min-w-0">
                                  <UserIdentity
                                    name={p.full_name}
                                    skillLevel={p.tennis_skill_level}
                                    avatarUrl={p.avatar_url}
                                    birthdayVisible={p.birthday_emoji_visible}
                                    compact
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    W:{records[p.user_id]?.wins ?? 0}, - L:
                                    {records[p.user_id]?.losses ?? 0}
                                  </p>
                                </div>
                              </DraggableItem>
                            );
                          })}
                        </div>
                      </AssignmentDropZone>
                    ))}
                  </div>
                  <AssignmentDropZone
                    variant="unassigned"
                    onDrop={(event) => {
                      const id = dragging || event.dataTransfer.getData('text/plain');
                      if (!id) return;
                      setSessions((old) =>
                        old.map((current, index) => {
                          if (index !== si) return current;
                          const next: Session = {
                            1: [...current[1]],
                            2: [...current[2]],
                            3: [...current[3]],
                            4: [...current[4]],
                          };
                          for (const court of [1, 2, 3, 4])
                            next[court] = next[court].filter((playerId) => playerId !== id);
                          return next;
                        }),
                      );
                      setDragging(null);
                    }}
                  >
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Unassigned players
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {participants
                        .filter(
                          (p) =>
                            p.status === 'confirmed' &&
                            ![1, 2, 3, 4].some((c) => session[c].includes(p.registration_id)),
                        )
                        .map((p) => (
                          <DraggableItem
                            key={p.registration_id}
                            id={p.registration_id}
                            appearance="assignment"
                            onDragStateChange={setDragging}
                          >
                            <div>
                              <UserIdentity
                                name={p.full_name}
                                skillLevel={p.tennis_skill_level}
                                avatarUrl={p.avatar_url}
                                compact
                              />
                              <p className="text-xs text-muted-foreground">
                                W:{records[p.user_id]?.wins ?? 0}, - L:
                                {records[p.user_id]?.losses ?? 0}
                              </p>
                            </div>
                          </DraggableItem>
                        ))}
                    </div>
                  </AssignmentDropZone>
                </section>
              ))}
              <Button variant="outline" onClick={onAddSession}>
                Add sub-session
              </Button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => onClose()}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void onSave()}>
                {busy ? <TennisLoader compact label="Saving" /> : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
