import type { DragEvent, HTMLAttributes } from 'react';

type DropZoneProps = Omit<HTMLAttributes<HTMLDivElement>, 'onDrop'> & {
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
};

export function DropZone({ children, onDrop, onDragOver, ...props }: DropZoneProps) {
  return (
    <div
      {...props}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver?.(event);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event);
      }}
    >
      {children}
    </div>
  );
}

export function AssignmentDropZone({
  variant,
  ...props
}: DropZoneProps & { variant: 'court' | 'unassigned' }) {
  const className =
    variant === 'court'
      ? 'min-h-44 rounded-lg border-2 border-dashed border-border bg-muted/20 p-3'
      : 'mt-3 min-h-20 rounded-lg border-2 border-dashed border-border bg-muted/30 p-3';

  return <DropZone {...props} className={className} />;
}

export function DraggableItem({
  id,
  dataType = 'text/plain',
  appearance = 'plain',
  children,
  className: customClassName,
  onDragStateChange,
  onDragStart,
  onDragEnd,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'onDragStart' | 'onDragEnd'> & {
  id: string;
  dataType?: string;
  appearance?: 'plain' | 'assignment';
  onDragStateChange?: (id: string | null) => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const appearanceClassName =
    appearance === 'assignment'
      ? 'flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background p-2 active:cursor-grabbing'
      : '';
  const className = [appearanceClassName, customClassName].filter(Boolean).join(' ');

  return (
    <div
      {...props}
      className={className}
      draggable
      onDragStart={(event) => {
        onDragStateChange?.(id);
        if (event.dataTransfer) {
          event.dataTransfer.setData(dataType, id);
          event.dataTransfer.effectAllowed = 'move';
        }
        onDragStart?.(event);
      }}
      onDragEnd={(event) => {
        onDragStateChange?.(null);
        onDragEnd?.(event);
      }}
    >
      {children}
    </div>
  );
}
