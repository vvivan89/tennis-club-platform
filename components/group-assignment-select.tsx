import type { ReactNode } from 'react';

type GroupAssignmentSelectProps = {
  ariaLabel: string;
  value: number | null;
  options: ReactNode;
  onChange: (value: string) => void;
};

export function GroupAssignmentSelect({
  ariaLabel,
  value,
  options,
  onChange,
}: GroupAssignmentSelectProps) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      Group
      <select
        aria-label={ariaLabel}
        className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Unassigned</option>
        {options}
      </select>
    </label>
  );
}
