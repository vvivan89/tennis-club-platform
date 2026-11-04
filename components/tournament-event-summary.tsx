import { dateLabel } from '@/components/tournament-public-view-format';
import { eventPriceLabel } from '@/lib/event-format';

export function TournamentEventSummary({
  leagueTournament,
  eventDescription,
  genderRestriction,
  locationQuery,
  startsAt,
  endsAt,
  registrationOpensAt,
  registrationClosesAt,
  priceCents,
}: {
  leagueTournament: boolean;
  eventDescription: string | null;
  genderRestriction: string | null;
  locationQuery: string;
  startsAt: string;
  endsAt: string | null;
  registrationOpensAt: string;
  registrationClosesAt: string | null;
  priceCents: number;
}) {
  return (
    <>
      <div className="order-1 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {leagueTournament
            ? priceCents === 0
              ? 'Free for members'
              : `${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(priceCents / 100)} per person`
            : eventPriceLabel(priceCents, false)}
        </span>
        {leagueTournament &&
          Date.now() >= new Date(startsAt).getTime() &&
          Date.now() <= new Date(endsAt || startsAt).getTime() && (
            <span className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              In progress
            </span>
          )}
        {leagueTournament && genderRestriction && (
          <span className="rounded-full bg-secondary px-3 py-1 text-xs">
            {genderRestriction === 'male' ? 'Male participants only' : 'Female participants only'}
          </span>
        )}
      </div>
      {leagueTournament && eventDescription?.trim() && (
        <p className="order-1 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
          {eventDescription.trim()}
        </p>
      )}
      <div
        className={
          leagueTournament ? 'order-1 grid gap-3 sm:grid-cols-2' : 'grid gap-3 sm:grid-cols-2'
        }
      >
        <section className="rounded-xl border border-border p-4">
          {leagueTournament ? (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Event</p>
          ) : (
            <h3 className="font-semibold">Tournament</h3>
          )}
          <p className="mt-2 text-sm">
            {leagueTournament
              ? `${dateLabel(startsAt)} · Until ${dateLabel(endsAt)}`
              : `${dateLabel(startsAt)}${endsAt ? ` – ${dateLabel(endsAt)}` : ''}`}
          </p>
          {leagueTournament && (
            <p className="mt-2 text-sm text-muted-foreground">{locationQuery}</p>
          )}
        </section>
        <section className="rounded-xl border border-border p-4">
          {leagueTournament ? (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Registration</p>
          ) : (
            <h3 className="font-semibold">Registration</h3>
          )}
          <p className="mt-2 text-sm">
            {leagueTournament
              ? `Opens ${dateLabel(registrationOpensAt)}`
              : `Opens: ${dateLabel(registrationOpensAt)}`}
          </p>
          <p className="text-sm">
            {leagueTournament
              ? `Cutoff ${registrationClosesAt ? dateLabel(registrationClosesAt) : 'Not set'}`
              : `Closes: ${dateLabel(registrationClosesAt || startsAt)}`}
          </p>
          {leagueTournament && (
            <p className="mt-2 text-sm text-muted-foreground">Active, paid membership required</p>
          )}
        </section>
      </div>
    </>
  );
}
