'use client';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { useState } from 'react';

export type PlayerGuardianContact = {
  name: string;
  email: string | null;
  phone: string | null;
};

export function UnderagePlayerBadge({
  playerName,
  age,
  guardians,
}: {
  playerName: string;
  age: number;
  guardians: PlayerGuardianContact[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="inline-flex shrink-0 items-center rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-foreground hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Underage player, age ${age}. View parent or legal guardian contacts for ${playerName}.`}
        onClick={() => setOpen(true)}
      >
        Under 18 · {age}
      </button>
      <ConfirmDialog
        open={open}
        title={`Parent/legal guardian contacts for ${playerName}`}
        description={
          guardians.length ? (
            <ul className="space-y-3">
              {guardians.map((guardian, index) => (
                <li
                  key={`${guardian.name}-${index}`}
                  className="rounded-md border border-border p-3"
                >
                  <p className="font-medium">{guardian.name}</p>
                  {guardian.email && (
                    <p className="mt-1">
                      Email:{' '}
                      <a className="text-primary underline" href={`mailto:${guardian.email}`}>
                        {guardian.email}
                      </a>
                    </p>
                  )}
                  {guardian.phone && (
                    <p className="mt-1">
                      Phone:{' '}
                      <a className="text-primary underline" href={`tel:${guardian.phone}`}>
                        {guardian.phone}
                      </a>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No parent or legal guardian contact is recorded for this player.</p>
          )
        }
        confirmLabel="Close"
        cancelLabel={null}
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
