import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1' } as null | { id: string },
  registrations: [] as Array<{ event_id: string; status: string }>,
  fromCalls: [] as string[],
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      mocks.fromCalls.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: mocks.registrations, error: null }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/event-card-weather', () => ({ EventCardWeather: () => null }));
vi.mock('@/components/event-card-actions', () => ({
  EventCardActions: ({ eventId }: { eventId: string }) => (
    <span data-testid={`actions-${eventId}`} />
  ),
}));
vi.mock('@/components/past-events-list', () => ({
  PastEventsList: ({ events }: { events: unknown[] }) => (
    <span data-testid="past-events">{events.length}</span>
  ),
}));

import { EventsBrowser } from '@/components/events-browser';

type Event = React.ComponentProps<typeof EventsBrowser>['events'][number];
function event(id: string, title: string, start: Date, overrides: Partial<Event> = {}): Event {
  return {
    id,
    title,
    description: null,
    starts_at: start.toISOString(),
    ends_at: null,
    registration_opens_at: new Date(start.getTime() - 86400000).toISOString(),
    registration_closes_at: null,
    capacity: 4,
    price_cents: 0,
    members_only: false,
    status: 'published',
    event_type: 'social',
    location: 'Courts',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.registrations = [{ event_id: 'this-week', status: 'confirmed' }];
  mocks.fromCalls = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EventsBrowser', () => {
  it('groups current-week events, displays spots and links, and includes past events', async () => {
    const today = new Date();
    const thisWeek = event('this-week', 'Wednesday Social', new Date(today.getTime() + 60000));
    const later = event(
      'later',
      'July Ladder',
      new Date(today.getFullYear(), today.getMonth() + 1, 10, 15),
      { price_cents: 1250, members_only: true },
    );
    const past = event('past', 'Old Open', new Date('2025-01-01T10:00:00Z'));
    render(
      <EventsBrowser
        events={[later, thisWeek]}
        pastEvents={[past]}
        counts={[{ event_id: 'this-week', confirmed_count: 3 }]}
        defaultLocation="Club courts"
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Wednesday Social/ })).toBeInTheDocument(),
    );
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText(/1\s+spots remaining/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Wednesday Social/ })).toHaveAttribute(
      'href',
      '/events/this-week',
    );
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByTestId('past-events')).toHaveTextContent('1');
  });

  it('shows the next week group when current week is empty and has an empty card fallback', async () => {
    render(<EventsBrowser events={[]} counts={[]} defaultLocation="" />);
    expect(await screen.findByText('Next week')).toBeInTheDocument();
    expect(screen.getAllByText('There are no events in this period.')).toHaveLength(2);
  });

  it('switches calendar period and navigates between months and weeks', async () => {
    const user = userEvent.setup();
    render(
      <EventsBrowser
        events={[event('cal', 'Calendar Match', new Date(Date.now() + 7 * 86400000 + 60000))]}
        counts={[]}
        defaultLocation=""
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Calendar view' }));
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const nextMonthLabel = new Intl.DateTimeFormat('en-CA', {
      month: 'long',
      year: 'numeric',
    }).format(nextMonth);
    expect(screen.getByRole('heading', { name: nextMonthLabel })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText(/Calendar Match/)).toBeInTheDocument();
  });

  it('shows calendar status for past, canceled, registered, full, open, and closed events', async () => {
    const now = Date.now();
    const makeToday = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000);
    const events = [
      event('past-cal', 'Past Calendar Event', makeToday(-120), {
        ends_at: makeToday(-60).toISOString(),
      }),
      event('canceled-cal', 'Canceled Calendar Event', makeToday(30), { status: 'cancelled' }),
      event('confirmed-cal', 'Confirmed Calendar Event', makeToday(45)),
      event('waitlisted-cal', 'Waitlisted Calendar Event', makeToday(60)),
      event('full-cal', 'Full Calendar Event', makeToday(75), { capacity: 1 }),
      event('open-cal', 'Open Calendar Event', makeToday(90)),
      event('closed-cal', 'Closed Calendar Event', makeToday(105), {
        registration_closes_at: makeToday(-1).toISOString(),
      }),
    ];
    mocks.registrations = [
      { event_id: 'confirmed-cal', status: 'confirmed' },
      { event_id: 'waitlisted-cal', status: 'waitlisted' },
    ];
    const user = userEvent.setup();
    render(
      <EventsBrowser
        events={events}
        counts={[{ event_id: 'full-cal', confirmed_count: 1 }]}
        defaultLocation="Club courts"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Calendar view' }));
    await user.click(screen.getByRole('button', { name: 'Week' }));

    expect(await screen.findByText('Past event')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('You are confirmed')).toBeInTheDocument();
    expect(screen.getByText('You are waitlisted')).toBeInTheDocument();
    expect(screen.getByText('Full · waitlist available')).toBeInTheDocument();
    expect(screen.getByText('Registration open')).toBeInTheDocument();
    expect(screen.getByText('Registration closed')).toBeInTheDocument();
  });

  it('skips the private registrations query for a signed-out visitor', async () => {
    mocks.user = null;
    render(
      <EventsBrowser
        events={[event('public-event', 'Public Event', new Date(Date.now() + 60_000))]}
        counts={[]}
        defaultLocation=""
      />,
    );

    expect(await screen.findByRole('link', { name: /Public Event/ })).toBeInTheDocument();
    expect(mocks.fromCalls).toEqual([]);
  });
});
