import type { DragEvent } from 'react';

type PriorityOption = readonly [key: string, label: string];

export function PriorityBuckets({
  options,
  priority,
  selectedAriaLabel,
  availableAriaLabel,
  priorityWidth = 'w-24',
  dataAttribute = 'ranking',
  lockedKeys = [],
  emptyPriorityMessage,
  stopRowDropPropagation = false,
  onDropSelectedPanel,
  onDropSelectedItem,
  onDropAvailablePanel,
  onDropAvailableItem,
  onAdd,
  onRemove,
  onReorder,
}: {
  options: readonly PriorityOption[];
  priority: string[];
  selectedAriaLabel: string;
  availableAriaLabel?: string;
  priorityWidth?: string;
  dataAttribute?: 'ranking' | 'ladder-ranking';
  lockedKeys?: readonly string[];
  emptyPriorityMessage?: string;
  stopRowDropPropagation?: boolean;
  onDropSelectedPanel: (source: string) => void;
  onDropSelectedItem: (source: string, targetKey: string, targetIndex: number) => void;
  onDropAvailablePanel: (source: string) => void;
  onDropAvailableItem: (source: string, targetKey: string) => void;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  onReorder: (key: string, targetIndex: number) => void;
}) {
  const selectedOptions = priority
    .map((key) => options.find(([optionKey]) => optionKey === key))
    .filter((option): option is PriorityOption => !!option);
  const availableOptions = options.filter(([key]) => !priority.includes(key));
  const dragKey = (event: DragEvent<HTMLElement>) => event.dataTransfer.getData('text/plain');
  const handleDrop = (event: DragEvent<HTMLElement>, callback: (key: string) => void) => {
    event.preventDefault();
    callback(dragKey(event));
  };
  const itemDataAttribute = (key: string) =>
    dataAttribute === 'ladder-ranking'
      ? { 'data-ladder-ranking-key': key }
      : { 'data-ranking-key': key };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div
        className="rounded-md border border-border p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, onDropSelectedPanel)}
      >
        <h3 className="mb-2 text-sm font-semibold">Selected priorities</h3>
        <ol className="space-y-2" aria-label={selectedAriaLabel}>
          {selectedOptions.map(([key, label]) => {
            const index = priority.indexOf(key);
            const locked = lockedKeys.includes(key);
            return (
              <li
                key={key}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', key);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = dragKey(event);
                  if (source && source !== key) onDropSelectedItem(source, key, index);
                  if (stopRowDropPropagation) event.stopPropagation();
                }}
                className="flex items-center gap-2 rounded-md border border-border bg-background p-2 text-sm"
                {...itemDataAttribute(key)}
              >
                <span aria-hidden="true" className="cursor-grab select-none text-muted-foreground">
                  ⠿
                </span>
                <span className={`${priorityWidth} shrink-0 text-muted-foreground`}>
                  Priority {index + 1}
                </span>
                <span className="flex-1">{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label} priority`}
                  disabled={locked}
                  onClick={() => onRemove(key)}
                  className="rounded border border-border px-2 py-1 disabled:opacity-40"
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} up`}
                  disabled={index === 0}
                  onClick={() => onReorder(key, index - 1)}
                  className="rounded border border-border px-2 py-1 disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} down`}
                  disabled={index === priority.length - 1 || locked}
                  onClick={() => onReorder(key, index + 1)}
                  className="rounded border border-border px-2 py-1 disabled:opacity-40"
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ol>
        {priority.length === 0 && emptyPriorityMessage && (
          <p className="text-sm text-muted-foreground">{emptyPriorityMessage}</p>
        )}
      </div>
      <div
        className="rounded-md border border-border p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, onDropAvailablePanel)}
      >
        <h3 className="mb-2 text-sm font-semibold">Available options</h3>
        <ul className="space-y-2" aria-label={availableAriaLabel}>
          {availableOptions.map(([key, label]) => (
            <li
              key={key}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', key);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onDropAvailableItem(dragKey(event), key);
                if (stopRowDropPropagation) event.stopPropagation();
              }}
              className="flex items-center justify-between rounded-md bg-secondary/40 p-2 text-sm"
              {...itemDataAttribute(key)}
            >
              <span className="cursor-grab">⠿ {label}</span>
              <button
                type="button"
                aria-label={`Add ${label} priority`}
                onClick={() => onAdd(key)}
                className="rounded border px-2"
              >
                +
              </button>
            </li>
          ))}
          {availableOptions.length === 0 && (
            <li className="text-sm text-muted-foreground">All options selected.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
