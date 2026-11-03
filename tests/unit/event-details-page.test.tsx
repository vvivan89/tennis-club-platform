import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  rows: {} as Record<string, unknown[]>,
  singles: {} as Record<string, unknown>,
  contacts: [] as unknown[],
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  rpcs: [] as string[],
  tournamentManagementProps: [] as unknown[],
  tournamentPublicViewProps: [] as unknown[],
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: async (name: string) => {
      mocks.rpcs.push(name);
      return { data: name === 'event_organizer_contacts' ? mocks.contacts : [], error: null };
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        or: () => query,
        neq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const value = mocks.singles[table];
          return {
            data: Array.isArray(value) ? (value.shift() ?? null) : (value ?? null),
            error: null,
          };
        },
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: mocks.rows[table] ?? [], error: null }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/event-detail-client', () => ({ EventDetailClient: () => null }));
vi.mock('@/components/event-edit-management', () => ({ EventEditManagement: () => null }));
vi.mock('@/components/tournament-management', () => ({
  TournamentManagement: (props: unknown) => {
    mocks.tournamentManagementProps.push(props);
    return <div data-testid="tournament-management" />;
  },
}));
vi.mock('@/components/tournament-public-view', () => ({
  TournamentPublicView: (props: { adminContent?: ReactNode }) => {
    mocks.tournamentPublicViewProps.push(props);
    return (
      <>
        <div data-testid="tournament-public-view" />
        {props.adminContent}
      </>
    );
  },
}));

import EventDetailsPage from '@/app/events/[slug]/page';

const publishedEvent = {
  id: 'event-1',
  slug: 'spring-open',
  title: 'Spring Open',
  status: 'published',
  created_by: 'organizer-1',
  organizer_id: 'organizer-1',
  starts_at: '2027-06-01T12:00:00Z',
  ends_at: '2027-06-01T14:00:00Z',
  registration_opens_at: '2027-01-01T00:00:00Z',
  registration_closes_at: null,
  capacity: 12,
  price_cents: 0,
  members_only: false,
  event_type: 'social',
  location: 'Courts',
  notes: '',
};
function setup(user: null | { id: string }, event: Record<string, unknown> = publishedEvent) {
  mocks.user = user;
  mocks.singles = {
    events: event,
    club_settings: {
      club_name: 'Club',
      short_name: 'C',
      social_links: [],
      location_query: 'Club courts',
    },
    registrations: null,
    profiles: user ? { role: 'member', application_status: 'approved' } : null,
    event_public_counts: { confirmed_count: 2 },
  };
  mocks.rows = {
    memberships: [],
    payments: [],
    membership_family_members: [],
    event_roster: [],
    event_court_assignments: [],
    event_scoreboard: [],
  };
  mocks.contacts = [];
  mocks.rpcs = [];
  mocks.tournamentManagementProps = [];
  mocks.tournamentPublicViewProps = [];
}

afterEach(() => {
  vi.clearAllMocks();
});
beforeEach(() => setup(null));

describe('EventDetailsPage', () => {
  it('renders published events for anonymous users without requesting private contacts', async () => {
    const page = await EventDetailsPage({ params: Promise.resolve({ slug: 'spring-open' }) });
    render(page);
    expect(screen.getByRole('heading', { name: 'Spring Open' })).toBeInTheDocument();
    expect(mocks.rpcs).not.toContain('event_organizer_contacts');
    expect(screen.queryByText('Event organizer')).not.toBeInTheDocument();
  });

  it('shows organizer contacts for an approved member with a historically paid membership', async () => {
    setup({ id: 'member-1' });
    mocks.rows.memberships = [
      { id: 'membership-1', payment_status: 'paid', status: 'expired', ends_on: '2020-09-30' },
    ];
    mocks.contacts = [
      {
        organizer_id: 'organizer-1',
        organizer_name: 'Jordan Organizer',
        position: 'Tournament director',
        emails: ['jordan@example.com'],
        phones: ['604-555-0111'],
      },
    ];
    const page = await EventDetailsPage({ params: Promise.resolve({ slug: 'spring-open' }) });
    render(page);
    expect(screen.getByText('Jordan Organizer')).toBeInTheDocument();
    expect(screen.getByText('Tournament director')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'jordan@example.com' })).toHaveAttribute(
      'href',
      'mailto:jordan@example.com',
    );
    expect(mocks.rpcs).toContain('event_organizer_contacts');
  });

  it('numbers a series event and gives a manager the edit control and roster tools', async () => {
    const seriesEvent = { ...publishedEvent, series_id: 'series-1' };
    setup({ id: 'admin-1' }, seriesEvent);
    mocks.singles.profiles = { role: 'admin', application_status: 'approved' };
    mocks.rows.events = [
      { id: 'event-1', series_id: 'series-1', starts_at: '2027-06-01T12:00:00Z' },
      { id: 'event-2', series_id: 'series-1', starts_at: '2027-06-08T12:00:00Z' },
    ];
    mocks.rows.event_roster = [
      { registration_id: 'reg-1', user_id: 'player-1', full_name: 'Player One' },
    ];
    const page = await EventDetailsPage({ params: Promise.resolve({ slug: 'spring-open' }) });
    render(page);
    expect(screen.getByRole('heading', { name: 'Spring Open #1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit event' })).toHaveAttribute(
      'href',
      '/admin/events/spring-open/edit',
    );
    expect(mocks.rpcs).toContain('event_member_directory');
  });

  it('does not reveal organizer data to a never-paid approved member', async () => {
    setup({ id: 'member-1' });
    mocks.singles.profiles = { role: 'member', application_status: 'approved' };
    mocks.contacts = [];
    const page = await EventDetailsPage({ params: Promise.resolve({ slug: 'spring-open' }) });
    render(page);
    expect(screen.queryByText('Event organizer')).not.toBeInTheDocument();
  });

  it('uses not-found behavior for missing events and private drafts viewed by non-managers', async () => {
    mocks.singles.events = null;
    await expect(
      EventDetailsPage({ params: Promise.resolve({ slug: 'missing' }) }),
    ).rejects.toThrow('not-found');
    setup({ id: 'member-1' }, { ...publishedEvent, status: 'draft', created_by: 'another-user' });
    await expect(
      EventDetailsPage({ params: Promise.resolve({ slug: 'spring-open' }) }),
    ).rejects.toThrow('not-found');
  });

  it('resolves a retired event slug through its alias and redirects to the canonical route', async () => {
    mocks.singles.events = [null, publishedEvent];
    mocks.singles.event_slug_aliases = { event_id: 'event-1' };
    await expect(
      EventDetailsPage({ params: Promise.resolve({ slug: 'old-spring-name' }) }),
    ).rejects.toThrow('redirect:/events/spring-open');
  });
});

describe('tournament event page integration', () => {
  it('renders the public tournament view for a published tournament and keeps management controls manager-only', async () => {
    const tournamentEvent = {
      ...publishedEvent,
      event_type: 'tournament',
      tournament_format: 'doubles',
      tournament_config: { categories: ['mixed'], phases: { round_robin: true } },
      tournament_rules_html: '<p>Rules</p>',
      tournament_details_public: true,
      allow_non_member_registration: false,
    };
    setup(null, tournamentEvent);
    const anonymousPage = await EventDetailsPage({
      params: Promise.resolve({ slug: 'spring-open' }),
    });
    render(anonymousPage);
    expect(screen.getByTestId('tournament-public-view')).toBeInTheDocument();
    expect(screen.queryByTestId('tournament-management')).not.toBeInTheDocument();
    expect(mocks.tournamentPublicViewProps).toHaveLength(1);

    cleanup();
    setup({ id: 'organizer-1' }, tournamentEvent);
    mocks.singles.profiles = { role: 'organizer', application_status: 'approved' };
    const managerPage = await EventDetailsPage({
      params: Promise.resolve({ slug: 'spring-open' }),
    });
    render(managerPage);
    expect(screen.getByTestId('tournament-management')).toBeInTheDocument();
    expect(screen.getByTestId('tournament-public-view')).toBeInTheDocument();
  });

  it('passes League snapshots, court defaults, and result status to the public tournament view', async () => {
    const leagueEvent = {
      ...publishedEvent,
      event_type: 'tournament',
      social_doubles_ladder_id: 'league-1',
      tournament_format: 'doubles',
      tournament_config: null,
      price_cents: null,
      court_count: null,
    };
    setup({ id: 'admin-1' }, leagueEvent);
    mocks.singles.profiles = { role: 'admin', application_status: 'approved' };
    mocks.singles.social_doubles_ladders = {
      id: 'league-1',
      name: 'Summer League',
      competition_type: 'league',
      gender: 'female',
    };
    mocks.singles.league_standings_snapshots = {
      standings: [{ user_id: 'p1' }],
      standings_after: [{ user_id: 'p1', points: 3 }],
    };
    mocks.rows.tournament_public_matches = [{ status: 'bye' }];
    const page = await EventDetailsPage({ params: Promise.resolve({ slug: 'spring-open' }) });
    render(page);
    expect(mocks.tournamentManagementProps[0]).toMatchObject({
      leagueTournament: true,
      leagueGender: 'female',
      courtCount: 4,
      priceCents: 0,
    });
    expect(mocks.tournamentPublicViewProps[0]).toMatchObject({
      leagueTournament: true,
      leagueStandingsBefore: [{ user_id: 'p1' }],
      leagueStandingsAfter: [{ user_id: 'p1', points: 3 }],
      leagueHasResults: true,
    });
  });
});
