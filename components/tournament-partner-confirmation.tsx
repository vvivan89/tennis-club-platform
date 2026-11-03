'use client';

import type { TournamentPartnerConfirmation as Confirmation } from '@/components/tournament-public-view-types';

export function TournamentPartnerConfirmation({
  confirmation,
  error,
  busy,
  onConfirm,
}: {
  confirmation: Confirmation | null;
  error: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  if (!confirmation)
    return error ? (
      <p role="alert" className="mt-3 text-sm text-destructive">
        {error}
      </p>
    ) : null;

  return (
    <>
      <section
        className="mt-4 rounded-lg border border-primary/30 bg-primary/[0.03] p-4"
        aria-label="Partner confirmation"
      >
        <h4 className="font-semibold">Confirm your tournament participation</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {confirmation.invitedBy} listed you as a partner for {confirmation.eventTitle}. Review
          your details and confirm to make the team eligible for payment.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">Name</dt>
            <dd>{confirmation.participantName}</dd>
          </div>
          <div>
            <dt className="font-medium">Email</dt>
            <dd>{confirmation.email}</dd>
          </div>
          <div>
            <dt className="font-medium">Phone</dt>
            <dd>{confirmation.phone || 'Not provided'}</dd>
          </div>
          <div>
            <dt className="font-medium">Gender</dt>
            <dd>{confirmation.gender || 'Not specified'}</dd>
          </div>
          <div>
            <dt className="font-medium">Tennis skill rating</dt>
            <dd>{confirmation.tennisSkillLevel ?? 'Not specified'}</dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="mt-4 h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Confirming…' : 'Confirm participation'}
        </button>
      </section>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
