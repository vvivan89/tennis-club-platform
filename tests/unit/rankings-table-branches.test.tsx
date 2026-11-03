import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RankingsTable } from '@/components/rankings-table';
import type { RankingPlayer } from '@/lib/player-rankings';

const players: RankingPlayer[] = [
  {
    id: 'a',
    name: 'Alex',
    gender: 'male',
    skillRating: 4.5,
    gamesWon: 12,
    gamesLost: 5,
    setsWon: 4,
    setsLost: 2,
    gamesPercentage: 70.6,
    setsPercentage: 66.7,
    gamesPlayed: 4,
  },
  {
    id: 'b',
    name: 'Blair',
    gender: 'female',
    skillRating: null,
    gamesWon: 8,
    gamesLost: 8,
    setsWon: 3,
    setsLost: 3,
    gamesPercentage: 50,
    setsPercentage: 50,
    gamesPlayed: 4,
  },
  {
    id: 'c',
    name: 'Casey',
    gender: 'male',
    skillRating: 3.5,
    gamesWon: 0,
    gamesLost: 0,
    setsWon: 0,
    setsLost: 0,
    gamesPercentage: 0,
    setsPercentage: 0,
    gamesPlayed: 0,
  },
];

describe('RankingsTable branch coverage', () => {
  it('filters by gender, lists unranked players, and sorts each standings column both ways', async () => {
    const user = userEvent.setup();
    const { container } = render(<RankingsTable players={players} currentUserId="a" />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('🥇')).toBeInTheDocument();
    expect(container.querySelector('summary')).toHaveTextContent('Players without a rank (1)');
    const maleFilter = screen.getByRole('button', { name: 'Male' });
    await user.click(maleFilter);
    expect(
      within(screen.getByRole('group', { name: 'Player gender' })).getByRole('button', {
        name: 'Male',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Blair')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Female' }));
    expect(screen.getByText('Blair')).toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All players' }));

    for (const header of ['Player', 'Games won %', 'Games', 'Sets', 'Skill rating']) {
      const buttons = screen.getAllByRole('button', { name: `Sort by ${header}` });
      await user.click(buttons[0]);
      await user.click(buttons[0]);
    }
  });

  it('applies ladder points, seed order, priority metrics, defaults, and point sorting', async () => {
    const user = userEvent.setup();
    const ladderPlayers = players.map((player) => ({ ...player, gamesPlayed: 0 }));
    render(
      <RankingsTable
        players={ladderPlayers}
        currentUserId="missing-user"
        ladderPoints={
          new Map([
            ['a', 5],
            ['b', 5],
            ['c', 5],
          ])
        }
        ladderRankingPriority={[
          'sets_won',
          'games_won',
          'games_difference',
          'sets_difference',
          'unknown',
        ]}
        ladderSeedOrder={
          new Map([
            ['a', 2],
            ['b', 1],
          ])
        }
        ladderPositionPoints={[]}
      />,
    );
    expect(screen.getByRole('button', { name: /Points/ })).toBeInTheDocument();
    expect(
      screen.getByText(/1st \+2 points, 2nd \+1 point, 3rd -1 point, 4th -2 points/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Points/ }));
    await user.click(screen.getByRole('button', { name: /Points/ }));
    await user.click(screen.getByRole('button', { name: 'Sort by Player' }));
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Alex');
  });
});
