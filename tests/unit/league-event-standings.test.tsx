import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LeagueEventStandings } from '@/components/league-event-standings';

afterEach(cleanup);

describe('LeagueEventStandings', () => {
  it('shows the before table, uses fallbacks for missing data, and handles empty periods', () => {
    const { rerender } = render(<LeagueEventStandings before={[]} after={[]} hasResults={false} />);
    expect(screen.getByText('No records yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'After this event' }));
    expect(screen.getByText('No results are available for this event yet.')).toBeInTheDocument();

    rerender(<LeagueEventStandings before={[{ team_id: 'team-a' }]} after={[]} hasResults />);
    fireEvent.click(screen.getByRole('button', { name: 'Before this event' }));
    const row = screen.getAllByRole('row')[1];
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['1', '', '0', '0', '0', '0–0', '0–0']);
    fireEvent.click(screen.getByRole('button', { name: 'After this event' }));
    expect(screen.getByText('No records yet.')).toBeInTheDocument();
  });

  it('shows rank movement for teams that rise, fall, stay level, or have no prior rank', () => {
    render(
      <LeagueEventStandings
        hasResults
        before={[
          { team_id: 'rise', team_name: 'Rising Aces', position: 4 },
          { team_id: 'fall', team_name: 'Falling Aces', position: 1 },
          { team_id: 'same', team_name: 'Steady Aces', position: 2 },
        ]}
        after={[
          { team_id: 'rise', team_name: 'Rising Aces', position: 1, wins: 3 },
          { team_id: 'fall', team_name: 'Falling Aces', position: 4 },
          { team_id: 'same', team_name: 'Steady Aces', position: 2 },
          { team_id: 'new', team_name: 'New Aces' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'After this event' }));

    expect(screen.getByLabelText('Moved up 3 places')).toBeInTheDocument();
    expect(screen.getByLabelText('Moved down 3 places')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Moved (up|down) 0/)).not.toBeInTheDocument();
    const risingRow = screen.getByRole('row', { name: /Rising Aces/ });
    const fallingRow = screen.getByRole('row', { name: /Falling Aces/ });
    const newRow = screen.getByRole('row', { name: /New Aces/ });
    expect(within(risingRow).getByLabelText('Moved up 3 places')).toBeInTheDocument();
    expect(within(fallingRow).getByLabelText('Moved down 3 places')).toBeInTheDocument();
    expect(within(newRow).queryByLabelText(/Moved/)).not.toBeInTheDocument();
  });
});
