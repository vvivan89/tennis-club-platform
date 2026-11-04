import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TournamentEventSummary } from '@/components/tournament-event-summary';
import { dateLabel } from '@/components/tournament-public-view-format';
import { eventPriceLabel } from '@/lib/event-format';

describe('TournamentEventSummary', () => {
  it('shows public price, event dates, and registration window for a tournament', () => {
    const startsAt = '2027-06-01T18:00:00.000Z';
    const endsAt = '2027-06-01T21:00:00.000Z';
    const registrationOpensAt = '2027-05-01T18:00:00.000Z';
    const registrationClosesAt = '2027-05-31T18:00:00.000Z';
    render(
      <TournamentEventSummary
        leagueTournament={false}
        eventDescription={null}
        genderRestriction={null}
        locationQuery="PCTC courts"
        startsAt={startsAt}
        endsAt={endsAt}
        registrationOpensAt={registrationOpensAt}
        registrationClosesAt={registrationClosesAt}
        priceCents={2500}
      />,
    );

    expect(screen.getByText(eventPriceLabel(2500, false))).toBeInTheDocument();
    const tournament = screen.getByRole('heading', { name: 'Tournament' }).parentElement;
    const registration = screen.getByRole('heading', { name: 'Registration' }).parentElement;
    expect(within(tournament as HTMLElement).getByText(/–/)).toHaveTextContent(
      `${dateLabel(startsAt)} – ${dateLabel(endsAt)}`,
    );
    expect(within(registration as HTMLElement).getByText(/Opens:/)).toHaveTextContent(
      `Opens: ${dateLabel(registrationOpensAt)}`,
    );
    expect(within(registration as HTMLElement).getByText(/Closes:/)).toHaveTextContent(
      `Closes: ${dateLabel(registrationClosesAt)}`,
    );
  });
});
