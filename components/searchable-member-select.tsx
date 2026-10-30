'use client';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
export type MemberOption = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  tennis_skill_level?: number | string | null;
  available?: boolean;
  unavailableReason?: string;
  statusText?: string;
  sortPriority?: number;
};
export function SearchableMemberSelect({
  options,
  value,
  onChange,
  placeholder = 'Search members…',
  disabled = false,
  className = '',
}: {
  options: MemberOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((x) => x.id === value);
  const filtered = useMemo(
    () =>
      options
        .filter((x) =>
          `${x.full_name || ''} ${x.email || ''} ${x.phone || ''}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            (a.sortPriority ?? 0) - (b.sortPriority ?? 0) ||
            Number(a.available === false) - Number(b.available === false),
        ),
    [options, query],
  );
  return (
    <div className={`relative ${className}`}>
      <Input
        value={
          open
            ? query
            : selected
              ? `${selected.full_name || selected.email || 'Member'}${selected.email && selected.full_name ? ` — ${selected.email}` : ''}`
              : query
        }
        disabled={disabled}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange('');
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-background p-1 shadow-lg"
        >
          {filtered.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.id === value}
              key={option.id}
              onMouseDown={(e) => e.preventDefault()}
              disabled={option.available === false}
              onClick={() => {
                if (option.available === false) return;
                onChange(option.id);
                setQuery('');
                setOpen(false);
              }}
              className="block w-full rounded px-3 py-2 text-left text-sm enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block font-medium">
                {option.full_name || 'Member'}
                {option.tennis_skill_level != null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {option.tennis_skill_level}
                  </span>
                )}
              </span>
              {option.statusText && (
                <span className="block text-xs text-muted-foreground">{option.statusText}</span>
              )}
              {option.available === false &&
                (option.unavailableReason || !option.statusText) &&
                option.unavailableReason !== option.statusText && (
                  <span className="block text-xs text-muted-foreground">
                    {option.unavailableReason || 'Already in a family or has a pending invitation'}
                  </span>
                )}
            </button>
          ))}
          {!filtered.length && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matching members.</p>
          )}
        </div>
      )}
    </div>
  );
}
