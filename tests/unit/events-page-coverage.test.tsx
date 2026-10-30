import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string; application_status: string },
  club: null as null | Record<string, unknown>,
  events: [] as Array<Record<string, unknown>> | null,
  eventError: null as null | { message: string },
  counts: null as null | Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      let operation = 'select';
      const query = {
        select: () => query,
        in: () => query,
        order: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: table === 'club_settings' ? mocks.club : mocks.profile }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(
            table === 'events'
              ? { data: mocks.events, error: mocks.eventError }
              : { data: mocks.counts, error: null },
          ).then(resolve, reject),
      };
      void operation;
      return query;
    },
  }),
}));
vi.mock('@/components/site-header', () => ({
  SiteHeader: ({ clubName, shortName }: { clubName: string; shortName: string }) => (
    <header>
      {clubName} {shortName}
    </header>
  ),
}));
vi.mock('@/components/site-footer', () => ({
  SiteFooter: ({ clubName }: { clubName: string }) => <footer>{clubName}</footer>,
}));
vi.mock('@/components/events-browser', () => ({
  EventsBrowser: ({
    events,
    pastEvents,
    counts,
    defaultLocation,
  }: {
    events: Array<{ title: string }>;
    pastEvents: Array<{ title: string }>;
    counts: unknown[];
    defaultLocation: string;
  }) => (
    <div data-testid="events-browser">
      <p>Upcoming: {events.map((event) => event.title).join(', ')}</p>
      <p>Past: {pastEvents.map((event) => event.title).join(', ')}</p>
      <p>Counts: {counts.length}</p>
      <p>Location: {defaultLocation}</p>
    </div>
  ),
}));

import EventsPage from '@/app/events/page';

beforeEach(() => {
  mocks.user = null;
  mocks.profile = null;
  mocks.club = null;
  mocks.events = [];
  mocks.eventError = null;
  mocks.counts = [];
});
afterEach(() => cleanup());

describe('EventsPage', () => {
  it('splits upcoming and past events and uses club defaults for anonymous visitors', async () => {
    mocks.events = [
      {
        id: 'upcoming',
        title: 'Upcoming Open',
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        ends_at: null,
      },
      {
        id: 'past',
        title: 'Past Social',
        starts_at: new Date(Date.now() - 172_800_000).toISOString(),
        ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ];
    mocks.counts = [{ event_id: 'upcoming', confirmed_count: 7 }];
    render(await EventsPage());

    expect(screen.getByTestId('events-browser')).toHaveTextContent('Upcoming: Upcoming Open');
    expect(screen.getByTestId('events-browser')).toHaveTextContent('Past: Past Social');
    expect(screen.getByTestId('events-browser')).toHaveTextContent('Counts: 1');
    expect(screen.getByTestId('events-browser')).toHaveTextContent(
      'Location: Port Coquitlam, British Columbia',
    );
    expect(screen.queryByRole('link', { name: 'Create event' })).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Port Coquitlam Tennis Club PCTC');
  });

  it('shows event creation only to approved administrators and organizers', async () => {
    mocks.club = {
      club_name: 'Custom Club',
      short_name: 'CC',
      social_links: [],
      location_query: 'Custom location',
    };
    mocks.user = { id: 'pending-admin' };
    mocks.profile = { role: 'admin', application_status: 'pending' };
    const pending = render(await EventsPage());
    expect(screen.queryByRole('link', { name: 'Create event' })).not.toBeInTheDocument();
    pending.unmount();

    mocks.profile = { role: 'organizer', application_status: 'approved' };
    render(await EventsPage());
    expect(screen.getByRole('link', { name: 'Create event' })).toHaveAttribute(
      'href',
      '/admin/events/create',
    );
    expect(screen.getByTestId('events-browser')).toHaveTextContent('Location: Custom location');
  });

  it('reports an event query error instead of rendering the browser', async () => {
    mocks.eventError = { message: 'database private details' };
    render(await EventsPage());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Events could not be loaded. Please try again later.',
    );
    expect(screen.queryByTestId('events-browser')).not.toBeInTheDocument();
  });
});
