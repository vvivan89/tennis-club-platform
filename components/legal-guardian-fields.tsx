'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { emptyLegalGuardian, isUnder18, type LegalGuardian } from '@/lib/player-guardian-details';

export function LegalGuardianFields({
  dateOfBirth,
  guardians,
  setGuardians,
}: {
  dateOfBirth: string;
  guardians: LegalGuardian[];
  setGuardians: Dispatch<SetStateAction<LegalGuardian[]>>;
}) {
  if (!isUnder18(dateOfBirth)) return null;
  const rows = guardians.length ? guardians : [emptyLegalGuardian()];
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3 sm:col-span-2">
      <legend className="px-1 text-sm font-medium">
        Parent/Legal Guardian <span className="text-destructive">*</span>
      </legend>
      <p className="text-xs text-muted-foreground">
        This player is under 18. Add at least one parent or legal guardian. Each person needs a name
        and at least one contact method; you can add more than one.
      </p>
      {rows.map((guardian, index) => (
        <div key={index} className="grid gap-3 rounded-md bg-secondary/30 p-3 sm:grid-cols-2">
          <label className="text-sm">
            Guardian name <span className="text-destructive">*</span>
            <Input
              autoComplete="name"
              value={guardian.name}
              onChange={(event) =>
                setGuardians((current) => {
                  const next = current.length ? [...current] : [emptyLegalGuardian()];
                  next[index] = { ...next[index], name: event.target.value };
                  return next;
                })
              }
              required
              maxLength={120}
            />
          </label>
          <label className="text-sm">
            Email
            <Input
              type="email"
              autoComplete="email"
              value={guardian.email}
              onChange={(event) =>
                setGuardians((current) => {
                  const next = current.length ? [...current] : [emptyLegalGuardian()];
                  next[index] = { ...next[index], email: event.target.value };
                  return next;
                })
              }
              maxLength={254}
            />
          </label>
          <label className="text-sm">
            Phone
            <Input
              type="tel"
              autoComplete="tel"
              value={guardian.phone}
              onChange={(event) =>
                setGuardians((current) => {
                  const next = current.length ? [...current] : [emptyLegalGuardian()];
                  next[index] = { ...next[index], phone: event.target.value };
                  return next;
                })
              }
              maxLength={40}
            />
          </label>
          {rows.length > 1 && (
            <button
              type="button"
              className="justify-self-start text-sm text-destructive underline"
              onClick={() => setGuardians((current) => current.filter((_, i) => i !== index))}
            >
              Remove guardian
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="text-sm font-medium text-primary underline"
        onClick={() => setGuardians((current) => [...current, emptyLegalGuardian()])}
      >
        Add another guardian
      </button>
    </fieldset>
  );
}
