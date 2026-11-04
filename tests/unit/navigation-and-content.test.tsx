import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RankingsTable } from '@/components/rankings-table';
import { RankingsCompetitionSelector } from '@/components/rankings-competition-selector';
import { SeasonSelector } from '@/components/season-selector';
import { PastEventsList } from '@/components/past-events-list';
import { MemberNav } from '@/components/member-nav';
import { AdminNav } from '@/components/admin-nav';
import { SiteFooter } from '@/components/site-footer';
import type { RankingPlayer } from '@/lib/player-rankings';

const mocks = vi.hoisted(() => ({
  pathname: '/member/dashboard',
  role: 'admin',
  club: { club_name: 'Example Tennis Club', short_name: 'ETC' },
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    channel: () => ({ on: () => ({ subscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'club_settings' ? mocks.club : { role: mocks.role },
        }),
      };
      return query;
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.pathname = '/member/dashboard';
  mocks.role = 'admin';
});

const players: RankingPlayer[] = [
  {
    id: 'p1',
    name: 'Alex',
    gender: 'male',
    skillRating: 3.5,
    gamesWon: 8,
    gamesLost: 2,
    setsWon: 2,
    setsLost: 0,
    gamesPercentage: 80,
    setsPercentage: 100,
    gamesPlayed: 2,
  },
  {
    id: 'p2',
    name: 'Blair',
    gender: 'female',
    skillRating: null,
    gamesWon: 4,
    gamesLost: 6,
    setsWon: 1,
    setsLost: 1,
    gamesPercentage: 40,
    setsPercentage: 50,
    gamesPlayed: 2,
  },
  {
    id: 'p3',
    name: 'Casey',
    gender: 'female',
    skillRating: 4,
    gamesWon: 0,
    gamesLost: 0,
    setsWon: 0,
    setsLost: 0,
    gamesPercentage: 0,
    setsPercentage: 0,
    gamesPlayed: 0,
  },
];

describe('navigation and content components', () => {
  it('filters, sorts, marks the current player, and keeps unranked players separate', async () => {
    const user = userEvent.setup();
    render(<RankingsTable players={players} currentUserId="p1" />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByLabelText('Rank 1')).toBeInTheDocument();
    expect(screen.getByText('Players without a rank')).toBeInTheDocument();

    const rankedTable = screen.getAllByRole('table')[0];
    await user.click(within(rankedTable).getByRole('button', { name: 'Sort by Player' }));
    const names = within(rankedTable)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
    expect(names[0]).toContain('Alex');
    expect(names[1]).toContain('Blair');

    await user.click(screen.getByRole('button', { name: 'Female' }));
    expect(within(rankedTable).queryByText('Alex')).not.toBeInTheDocument();
    expect(within(rankedTable).getByText('Blair')).toBeInTheDocument();
  });

  it('switches ranking period to a ladder and sorts ladder ties through configured metrics', async () => {
    const user = userEvent.setup();
    const points = new Map([
      ['p1', 4],
      ['p2', 4],
      ['p3', 1],
    ]);
    render(
      <RankingsTable
        players={players}
        currentUserId="p1"
        ladderPoints={points}
        ladderRankingPriority={['games_won', 'sets_won']}
        ladderSeedOrder={
          new Map([
            ['p1', 2],
            ['p2', 1],
          ])
        }
        competitionSelector={
          <RankingsCompetitionSelector
            value="2026"
            options={[
              { value: '2026', label: 'Full 2026 season' },
              { value: '2025', label: 'Full 2025 season' },
              { value: 'ladder:ladder-1', label: "Summer ladder (Women's ladder)" },
              { value: 'league:league-1', label: 'Summer league' },
              { value: 'tournament:tournament-1', label: 'Summer tournament' },
            ]}
          />
        }
      />,
    );

    const period = screen.getByLabelText('Competition');
    expect(
      within(period as HTMLElement).getByRole('option', { name: 'Full 2026 season' }),
    ).toBeInTheDocument();
    await user.selectOptions(period, 'ladder:ladder-1');
    expect(mocks.push).toHaveBeenCalledWith('/rankings?ladder=ladder-1', { scroll: false });
    expect(
      screen.getByRole('option', { name: "Summer ladder (Women's ladder)" }),
    ).toBeInTheDocument();
    await user.selectOptions(period, 'league:league-1');
    expect(mocks.push).toHaveBeenLastCalledWith('/rankings?league=league-1', { scroll: false });
    await user.selectOptions(period, 'tournament:tournament-1');
    expect(mocks.push).toHaveBeenLastCalledWith('/rankings?tournament=tournament-1', {
      scroll: false,
    });
    await user.selectOptions(period, '2025');
    expect(mocks.push).toHaveBeenLastCalledWith('/rankings?season=2025', { scroll: false });

    const rankedTable = screen.getAllByRole('table')[0];
    const rankedRows = within(rankedTable).getAllByRole('row').slice(1);
    expect(rankedRows[0]).toHaveTextContent('Alex');
    await user.click(within(rankedTable).getByRole('button', { name: /Points/ }));
    expect(within(rankedTable).getAllByRole('row')[1]).toHaveTextContent('Casey');
    await user.click(screen.getByRole('button', { name: 'Male' }));
    expect(within(rankedTable).queryByText('Jordan')).not.toBeInTheDocument();
  });

  it('sorts ranked players by games, sets, skill, and name in both directions', async () => {
    const user = userEvent.setup();
    render(<RankingsTable players={players} currentUserId="missing" />);
    const rankedTable = screen.getAllByRole('table')[0];
    await user.click(within(rankedTable).getByRole('button', { name: 'Sort by Games' }));
    expect(within(rankedTable).getAllByRole('row')[1]).toHaveTextContent('Alex');
    await user.click(within(rankedTable).getByRole('button', { name: 'Sort by Sets' }));
    await user.click(within(rankedTable).getByRole('button', { name: 'Sort by Skill rating' }));
    expect(within(rankedTable).getAllByRole('row')[1]).toHaveTextContent(/Alex|Blair|Casey/);
    await user.click(within(rankedTable).getByRole('button', { name: 'Sort by Player' }));
    await user.click(within(rankedTable).getByRole('button', { name: 'Sort by Player' }));
    expect(within(rankedTable).getAllByRole('row')[1]).toHaveTextContent('Blair');
  });

  it('updates the selected season in the current path without scrolling', async () => {
    mocks.push.mockClear();
    const user = userEvent.setup();
    render(<SeasonSelector path="/rankings" season="2025" years={[2024, 2025, 2026]} />);
    await user.selectOptions(screen.getByLabelText('Season'), '2026');
    expect(mocks.push).toHaveBeenCalledWith('/rankings?season=2026', { scroll: false });
  });

  it('searches past events, orders matching entries newest first, and shows empty results', async () => {
    const user = userEvent.setup();
    render(
      <PastEventsList
        events={[
          {
            id: 'old',
            title: 'Winter Open',
            description: 'Indoor doubles',
            starts_at: '2024-01-10T12:00:00Z',
            registration_opens_at: '',
            registration_closes_at: null,
            capacity: 8,
            price_cents: 0,
            members_only: false,
            status: 'published',
            event_type: 'social',
          },
          {
            id: 'new',
            slug: 'summer-open',
            title: 'Summer Open',
            description: null,
            starts_at: '2025-07-10T12:00:00Z',
            registration_opens_at: '',
            registration_closes_at: null,
            capacity: 8,
            price_cents: 0,
            members_only: false,
            status: 'cancelled',
            event_type: 'social',
          },
        ]}
      />,
    );
    await user.click(screen.getByText('Past events (2)'));
    const cards = screen.getByText('Summer Open').closest('a');
    expect(cards).toHaveAttribute('href', '/events/summer-open');
    await user.type(screen.getByLabelText('Search past events'), 'doubles');
    expect(screen.getByText('Winter Open')).toBeInTheDocument();
    expect(screen.queryByText('Summer Open')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search past events'));
    await user.type(screen.getByLabelText('Search past events'), 'no event');
    expect(screen.getByText('No past events match your search.')).toBeInTheDocument();
  });

  it('marks only the exact dashboard route as current in member navigation', () => {
    mocks.pathname = '/member/dashboard/settings';
    render(<MemberNav />);
    expect(screen.getByRole('link', { name: /dashboard/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /profile/i })).not.toHaveAttribute('aria-current');
    expect(
      screen.getByRole('navigation', { name: 'Member portal navigation' }),
    ).toBeInTheDocument();
  });

  it('shows role-specific admin navigation and groups nested sections as active', async () => {
    mocks.pathname = '/admin/applications/pending';
    const { unmount } = render(<AdminNav />);
    expect(await screen.findByText('Admin Portal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /membership/i })).toHaveAttribute(
      'aria-current',
      'page',
    );

    unmount();
    mocks.role = 'organizer';
    render(<AdminNav />);
    expect(await screen.findByText('Organizer Portal')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /audit logs/i })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Administration navigation' })).getByRole(
        'link',
        { name: 'Events' },
      ),
    ).toBeInTheDocument();
  });

  it('uses supplied footer settings and selects social icons by hostname', () => {
    render(
      <SiteFooter
        clubName="Northside Tennis"
        shortName="NTC"
        socialLinks={[
          { url: 'https://instagram.com/club' },
          { url: 'https://x.com/club' },
          { url: 'https://example.com/club' },
        ]}
      />,
    );
    expect(screen.getByText('Northside Tennis')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Northside Tennis (NTC)');
    expect(screen.queryByRole('link', { name: 'Contacts' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Social media link 1' })).toHaveAttribute(
      'href',
      'https://instagram.com/club',
    );
    expect(screen.getByRole('link', { name: 'Social media link 2' })).toHaveAttribute(
      'href',
      'https://x.com/club',
    );
    expect(screen.getAllByRole('link', { name: /Social media link/ })).toHaveLength(3);
  });
});
