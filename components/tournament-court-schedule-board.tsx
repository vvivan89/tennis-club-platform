import { DraggableItem, DropZone } from '@/components/drag-drop';

type CourtScheduleMatch = {
  id: string;
  court_number: number | null;
  scheduled_at: string | null;
  status: string;
};

type CourtScheduleConflict = {
  key: string;
  court: number;
  severity: 'danger' | 'warning';
  previousPlayers: string;
  previousTime: string;
  currentPlayers: string;
  currentTime: string;
};

export function TournamentCourtScheduleBoard<T extends CourtScheduleMatch>({
  courtCount,
  matches,
  conflicts,
  getMatchLabels,
  formatScheduledTime,
  onMoveMatchToCourt,
}: {
  courtCount: number;
  matches: T[];
  conflicts: CourtScheduleConflict[];
  getMatchLabels: (match: T) => { players: string; stage: string };
  formatScheduledTime: (value: string) => string;
  onMoveMatchToCourt: (matchId: string, court: number) => void;
}) {
  const courtTotal = Math.max(1, courtCount);
  const conflictsFor = (severity: CourtScheduleConflict['severity']) =>
    conflicts.filter((conflict) => conflict.severity === severity);

  return (
    <div>
      <h4 className="font-medium">Court assignment</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Drag a match to a court, or use the court selector on the match below.
      </p>
      {conflicts.length > 0 && (
        <div className="mt-3 space-y-2" role="status" aria-live="polite">
          {conflictsFor('danger').length > 0 && (
            <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              <p className="font-semibold">Scheduling conflicts — immediate overlap</p>
              {conflictsFor('danger').map((item) => (
                <p key={item.key} className="mt-1">
                  Court {item.court}: {item.previousPlayers} ({item.previousTime}) overlaps with{' '}
                  {item.currentPlayers} ({item.currentTime}).
                </p>
              ))}
            </div>
          )}
          {conflictsFor('warning').length > 0 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <p className="font-semibold">Scheduling warnings — insufficient break</p>
              {conflictsFor('warning').map((item) => (
                <p key={item.key} className="mt-1">
                  Court {item.court}: insufficient break between {item.previousPlayers} (
                  {item.previousTime}) and {item.currentPlayers} ({item.currentTime}).
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: courtTotal }, (_, index) => index + 1).map((court) => (
          <DropZone
            key={court}
            onDrop={(event) => {
              const matchId = event.dataTransfer.getData('application/x-pctc-match-id');
              if (matchId) onMoveMatchToCourt(matchId, court);
            }}
            className="min-h-32 rounded-md border border-dashed border-border bg-secondary/20 p-2"
          >
            <p className="text-sm font-semibold">Court {court}</p>
            <div className="mt-2 space-y-2">
              {matches
                .filter((match) => match.court_number === court && match.status !== 'cancelled')
                .sort(
                  (a, b) =>
                    (a.scheduled_at
                      ? new Date(a.scheduled_at).getTime()
                      : Number.MAX_SAFE_INTEGER) -
                    (b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER),
                )
                .map((match) => {
                  const names = getMatchLabels(match);
                  return (
                    <DraggableItem
                      key={match.id}
                      id={match.id}
                      dataType="application/x-pctc-match-id"
                      className="cursor-grab rounded-md border border-border bg-background px-2 py-2 text-xs shadow-sm active:cursor-grabbing"
                      title="Drag to another court to reassign"
                    >
                      <p className="font-semibold">
                        {match.scheduled_at
                          ? formatScheduledTime(match.scheduled_at)
                          : 'Time not scheduled'}
                      </p>
                      <p className="mt-1 leading-snug text-muted-foreground">
                        {names.players} · {names.stage}
                      </p>
                    </DraggableItem>
                  );
                })}
            </div>
          </DropZone>
        ))}
      </div>
    </div>
  );
}
