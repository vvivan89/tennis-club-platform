import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  calls: [] as Array<{ table: string; operation: string; values?: unknown }>,
  eventResult: { data: [{ id: 'event-1' }], error: null as null | { message: string } },
  eventRows: [] as Array<{ id: string }>,
  seriesResult: { data: { id: 'series-1' }, error: null as null | { message: string } },
  updateResults: [] as Array<{ data: unknown; error: null | { message: string } }>,
  push: vi.fn(),
  refresh: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      let operation = 'select';
      let values: unknown;
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        insert: (payload: unknown) => {
          operation = 'insert';
          values = payload;
          mocks.calls.push({ table, operation, values });
          return query;
        },
        update: (payload: unknown) => {
          operation = 'update';
          values = payload;
          mocks.calls.push({ table, operation, values });
          return query;
        },
        single: async () => mocks.seriesResult,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(
            table === 'events' && operation === 'insert'
              ? mocks.eventResult
              : table === 'events' && operation === 'update'
                ? (mocks.updateResults.shift() ?? { data: null, error: null })
                : table === 'events'
                  ? { data: mocks.eventRows, error: null }
                  : { data: null, error: null },
          ).then(resolve, reject),
      };
      return query;
    },
  }),
}));

import { EventManagementForm } from '@/components/event-management-form';

async function fillValidEvent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Event title'), '  Friday Social  ');
  await user.type(screen.getByLabelText('Event starts'), '2030-01-10T18:00');
  await user.type(screen.getByLabelText('Event ends'), '2030-01-10T20:00');
  await user.type(screen.getByLabelText('Registration opens'), '2030-01-01T18:00');
  await user.type(screen.getByLabelText('Registration cutoff'), '2030-01-09T18:00');
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.calls = [];
  mocks.eventResult = { data: [{ id: 'event-1' }], error: null };
  mocks.eventRows = [];
  mocks.seriesResult = { data: { id: 'series-1' }, error: null };
  mocks.updateResults = [];
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('EventManagementForm persistence', () => {
  it('validates chronological session and registration windows before database writes', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.type(screen.getByLabelText('Event title'), 'Invalid event');
    await user.type(screen.getByLabelText('Event starts'), '2030-01-10T20:00');
    await user.type(screen.getByLabelText('Event ends'), '2030-01-10T18:00');
    await user.type(screen.getByLabelText('Registration opens'), '2030-01-01T18:00');
    await user.type(screen.getByLabelText('Registration cutoff'), '2030-01-09T18:00');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mocks.calls).toEqual([]);
  });

  it('rejects non-positive category capacities before database writes', async () => {
    const user = userEvent.setup();
    const { container } = render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'doubles_tournament');
    const mixedFields = screen.getAllByLabelText('Mixed doubles');
    const categoryCapacity = mixedFields.find(
      (field) => field instanceof HTMLInputElement && field.type === 'number',
    );
    expect(categoryCapacity).toBeDefined();
    await user.clear(categoryCapacity as HTMLInputElement);
    await user.type(categoryCapacity as HTMLInputElement, '0');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Capacity for mixed must be a positive whole number or left blank.',
    );
    expect(mocks.calls).toEqual([]);
  });

  it('creates a new League series using its selected gender and shared League configuration', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'league_tournament');
    await user.type(screen.getByLabelText('Repeat until'), '2030-01-10');
    await user.type(screen.getByLabelText('League name'), 'Summer League');
    await user.selectOptions(screen.getByLabelText('League gender'), 'female');
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/events'));
    expect(
      mocks.calls.find((call) => call.table === 'social_doubles_ladders')?.values,
    ).toMatchObject({
      name: 'Summer League',
      gender: 'female',
      competition_type: 'league',
    });
    expect(mocks.calls.find((call) => call.table === 'events')?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gender_restriction: 'female', tournament_format: 'doubles' }),
      ]),
    );
  });

  it('creates a Social Doubles Ladder and links its event with the selected scoring configuration', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'social_doubles_ladder');
    await user.type(screen.getByLabelText('Repeat until'), '2030-01-10');
    await user.selectOptions(
      screen.getByLabelText('Associate with existing ladder (optional)'),
      '',
    );
    await user.type(screen.getByLabelText('Ladder name'), 'Winter Doubles');
    await user.selectOptions(screen.getByLabelText('Ladder gender'), 'female');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/events'));
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'social_doubles_ladders',
        operation: 'insert',
        values: expect.objectContaining({
          name: 'Winter Doubles',
          gender: 'female',
          ranking_priority: expect.arrayContaining(['games_won']),
        }),
      }),
    );
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'events',
        operation: 'update',
        values: expect.objectContaining({
          ladder_gender: 'female',
          social_doubles_ladder_id: 'series-1',
        }),
      }),
    );
  });

  it('requires a unique ladder name before saving a new ladder event', async () => {
    const user = userEvent.setup();
    const { container } = render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'social_doubles_ladder');
    await user.type(screen.getByLabelText('Repeat until'), '2030-01-10');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a name for this ladder.');
    expect(mocks.calls).toEqual([]);
  });

  it('requires a League name after the recurring schedule has been supplied', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.selectOptions(screen.getByLabelText('Event type'), 'league_tournament');
    await user.type(screen.getByLabelText('Repeat until'), '2030-01-10');
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(await screen.findByText('Enter a name for this league.')).toBeInTheDocument();
    expect(mocks.calls).toEqual([]);
  });

  it('creates a single event with normalized values and the selected organizer', async () => {
    const user = userEvent.setup();
    render(
      <EventManagementForm
        currentUserId="admin-1"
        organizerOptions={[
          { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' },
          {
            id: 'organizer-1',
            full_name: 'Organizer',
            email: 'org@example.com',
            role: 'organizer',
          },
        ]}
        showOrganizerField
      />,
    );
    await fillValidEvent(user);
    await user.selectOptions(screen.getByLabelText('Organizer'), 'organizer-1');
    await user.clear(screen.getByLabelText('Cost per person (CAD)'));
    await user.type(screen.getByLabelText('Cost per person (CAD)'), '12.50');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/events'));
    const inserted = mocks.calls.find((call) => call.table === 'events')?.values as Array<
      Record<string, unknown>
    >;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      title: 'Friday Social',
      organizer_id: 'organizer-1',
      created_by: 'admin-1',
      price_cents: 1250,
      capacity: 16,
      status: 'published',
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/notifications/dispatch',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates a recurring series with three separate event sessions', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.click(screen.getByRole('button', { name: 'Series of events' }));
    await user.type(screen.getByLabelText('Repeat until'), '2030-01-24');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/events'));
    const series = mocks.calls.find((call) => call.table === 'event_series');
    const sessions = mocks.calls.find((call) => call.table === 'events')?.values as Array<
      Record<string, unknown>
    >;
    expect(series?.values).toMatchObject({ title: 'Friday Social', created_by: 'admin-1' });
    expect(sessions).toHaveLength(3);
    expect(sessions.map((row) => row.series_id)).toEqual(['series-1', 'series-1', 'series-1']);
    expect(sessions[1].starts_at).not.toBe(sessions[0].starts_at);
    expect(
      sessions.every(
        (row) => new Date(String(row.registration_opens_at)) < new Date(String(row.starts_at)),
      ),
    ).toBe(true);
  });

  it('does not navigate when the database rejects the event insert', async () => {
    mocks.eventResult = { data: [], error: { message: 'event insert failed' } };
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save event. Please try again.',
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('rejects missing authentication and invalid registration boundaries before event writes', async () => {
    const user = userEvent.setup();
    mocks.user = null;
    const signedOut = render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again to continue.');
    expect(mocks.calls).toEqual([]);
    signedOut.unmount();

    mocks.user = { id: 'admin-1' };
    const invalidOpen = render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.clear(screen.getByLabelText('Registration opens'));
    await user.type(screen.getByLabelText('Registration opens'), '2030-01-11T18:00');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Registration must open before the event starts.',
    );
    expect(mocks.calls).toEqual([]);
    invalidOpen.unmount();

    const invalidCutoff = render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.clear(screen.getByLabelText('Registration cutoff'));
    await user.type(screen.getByLabelText('Registration cutoff'), '2030-01-10T19:00');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Registration cutoff must be on or before the event start.',
    );
    expect(mocks.calls).toEqual([]);
  });

  it('generates monthly sessions across short months and reports recurring-series insert failures', async () => {
    const user = userEvent.setup();
    const monthly = render(<EventManagementForm currentUserId="admin-1" />);
    await user.type(screen.getByLabelText('Event title'), 'Month-end ladder');
    await user.type(screen.getByLabelText('Event starts'), '2030-01-31T18:00');
    await user.type(screen.getByLabelText('Event ends'), '2030-01-31T20:00');
    await user.click(screen.getByRole('button', { name: 'Series of events' }));
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    await user.type(screen.getByLabelText('Repeat until'), '2030-03-31');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/events'));
    const sessions = mocks.calls.find((call) => call.table === 'events')?.values as Array<
      Record<string, unknown>
    >;
    expect(
      sessions.map((row) =>
        new Intl.DateTimeFormat('en-CA', { day: 'numeric' }).format(
          new Date(String(row.starts_at)),
        ),
      ),
    ).toEqual(['31', '28', '28']);

    monthly.unmount();
    mocks.calls = [];
    mocks.push.mockReset();
    mocks.seriesResult = {
      data: null as unknown as { id: string },
      error: { message: 'series insert failed' },
    };
    const rejected = render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.click(screen.getByRole('button', { name: 'Series of events' }));
    await user.type(screen.getByLabelText('Repeat until'), '2030-01-24');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save event');
    expect(mocks.calls.some((call) => call.table === 'events' && call.operation === 'insert')).toBe(
      false,
    );
    expect(mocks.push).not.toHaveBeenCalled();
    rejected.unmount();
  });

  it('rejects recurring open and cutoff schedules that overlap the session', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.click(screen.getByRole('button', { name: 'Series of events' }));
    await user.type(screen.getByLabelText('Repeat until'), '2030-01-17');
    await user.clear(screen.getByLabelText('Open registration days before'));
    await user.type(screen.getByLabelText('Open registration days before'), '0');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Recurring registration must open before each event.',
    );
    expect(mocks.calls).toEqual([]);

    await user.clear(screen.getByLabelText('Open registration days before'));
    await user.type(screen.getByLabelText('Open registration days before'), '3');
    await user.clear(screen.getByLabelText('Registration cutoff days before'));
    await user.type(screen.getByLabelText('Registration cutoff days before'), '0');
    await user.clear(screen.getByLabelText('Registration cutoff time'));
    await user.type(screen.getByLabelText('Registration cutoff time'), '19:00');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Recurring registration cutoff must be on or before each event.',
    );
    expect(mocks.calls).toEqual([]);
  });

  it('stops recurrence ranges at the supported session limit and treats notification failure as non-blocking', async () => {
    const user = userEvent.setup();
    const longRange = render(<EventManagementForm currentUserId="admin-1" />);
    await fillValidEvent(user);
    await user.click(screen.getByRole('button', { name: 'Series of events' }));
    await user.type(screen.getByLabelText('Repeat until'), '2040-01-10');
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The recurrence range is too long.');
    expect(mocks.calls).toEqual([]);
    longRange.unmount();

    const userForSingle = userEvent.setup();
    const single = render(<EventManagementForm currentUserId="admin-1" />);
    mocks.fetch.mockRejectedValue(new Error('network unavailable'));
    await fillValidEvent(userForSingle);
    await userForSingle.click(
      screen.getByRole('button', { name: /Create (event|events|tournament)/ }),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/events'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    single.unmount();
  });

  it('updates a single event and preserves independently editable session dates', async () => {
    const user = userEvent.setup();
    render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          id: 'event-1',
          title: 'Existing social',
          starts_at: '2030-01-10T18:00:00.000Z',
          ends_at: '2030-01-10T20:00:00.000Z',
          registration_opens_at: '2030-01-01T18:00:00.000Z',
          registration_closes_at: '2030-01-09T18:00:00.000Z',
          status: 'published',
          created_by: 'admin-1',
        }}
      />,
    );
    await user.clear(screen.getByLabelText('Event title'));
    await user.type(screen.getByLabelText('Event title'), 'Updated social');
    await user.click(screen.getByRole('button', { name: 'Save event changes' }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/events/event-1'));
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'events',
        operation: 'update',
        values: expect.objectContaining({
          title: 'Updated social',
          starts_at: expect.stringContaining('2030-01-10'),
          registration_closes_at: expect.stringContaining('2030-01-09'),
        }),
      }),
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('updates recurring fields separately and dispatches cancellation for every session', async () => {
    mocks.eventRows = [{ id: 'event-1' }, { id: 'event-2' }, { id: 'event-3' }];
    const user = userEvent.setup();
    render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          id: 'event-1',
          series_id: 'series-1',
          title: 'Weekly social',
          starts_at: '2030-01-10T18:00:00.000Z',
          ends_at: '2030-01-10T20:00:00.000Z',
          registration_opens_at: '2030-01-01T18:00:00.000Z',
          registration_closes_at: '2030-01-09T18:00:00.000Z',
          status: 'published',
          created_by: 'admin-1',
        }}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /Apply shared fields/ }));
    await user.selectOptions(screen.getByLabelText('Publication'), 'cancelled');
    await user.click(screen.getByRole('button', { name: 'Save event changes' }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/events/event-1'));
    expect(
      mocks.calls.filter((call) => call.table === 'events' && call.operation === 'update'),
    ).toHaveLength(2);
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'events',
        operation: 'update',
        values: expect.objectContaining({ status: 'cancelled', title: 'Weekly social' }),
      }),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/notifications/dispatch',
      expect.objectContaining({
        body: JSON.stringify({ eventIds: ['event-1', 'event-2', 'event-3'] }),
      }),
    );
  });
});
