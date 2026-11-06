import type { Dispatch, SetStateAction } from 'react';
import { DraggableItem } from '@/components/drag-drop';

export type GroupOverrideEditor = {
  category: string;
  group: number;
  rows: Array<{ id: string; name: string; promoted: boolean }>;
};

export function TournamentGroupOverrideDialog({
  editor,
  setEditor,
  reason,
  setReason,
  saving,
  error,
  draggedEntryId,
  setDraggedEntryId,
  moveRow,
  onSave,
}: {
  editor: GroupOverrideEditor | null;
  setEditor: Dispatch<SetStateAction<GroupOverrideEditor | null>>;
  reason: string;
  setReason: (reason: string) => void;
  saving: boolean;
  error: string;
  draggedEntryId: string | null;
  setDraggedEntryId: (id: string | null) => void;
  moveRow: (entryId: string, targetId: string) => void;
  onSave: () => void;
}) {
  if (!editor) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) setEditor(null);
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
              Override standings — Group {editor.group}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Drag rows to change positions and toggle promotion badges.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={saving}
            onClick={() => setEditor(null)}
            className="rounded-md px-2 py-1 hover:bg-secondary"
          >
            ×
          </button>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          {editor.rows.map((row, index) => (
            <DraggableItem
              key={row.id}
              id={row.id}
              onDragStateChange={setDraggedEntryId}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedEntryId) moveRow(draggedEntryId, row.id);
              }}
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
                  onClick={() => moveRow(row.id, editor.rows[index - 1].id)}
                  className="rounded border border-border px-2 py-1 text-xs leading-5 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.name} down`}
                  title="Move down"
                  disabled={index === editor.rows.length - 1}
                  onClick={() => moveRow(row.id, editor.rows[index + 1].id)}
                  className="rounded border border-border px-2 py-1 text-xs leading-5 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↓
                </button>
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.promoted}
                    onChange={(event) =>
                      setEditor((current) =>
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
            </DraggableItem>
          ))}
        </div>
        <label className="mt-4 block text-sm font-medium">
          Reason for all changes in this group
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-background p-2 font-normal"
            placeholder="Explain why the standings or promotion status changed."
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditor(null)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !reason.trim()}
            onClick={onSave}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </section>
    </div>
  );
}
