import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventManagementForm } from '@/components/event-management-form';

const eventFormMocks = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; values: unknown }>,
  readRows: {} as Record<string, unknown[]>,
  errors: {} as Record<string, Error>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: (table: string) => {
      let operation = 'select';
      let values: unknown;
      const query = {
        select: () => query,
        order: () => query,
        eq: () => query,
        in: () => query,
        insert: (nextValues: unknown) => {
          operation = 'insert';
          values = nextValues;
          eventFormMocks.inserts.push({ table, values });
          return query;
        },
        update: (nextValues: unknown) => {
          operation = 'update';
          values = nextValues;
          eventFormMocks.updates.push({ table, values });
          return query;
        },
        single: async () => ({
          data: { id: `created-${table}` },
          error: eventFormMocks.errors[`${table}.${operation}.single`] ?? null,
        }),
        then: (
          resolve: (value: { data: unknown[]; error: Error | null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({
            data:
              table === 'events' && operation === 'insert' && Array.isArray(values)
                ? values.map((_, index) => ({ id: `created-event-${index + 1}` }))
                : (eventFormMocks.readRows[table] ?? []),
            error: eventFormMocks.errors[`${table}.${operation}.then`] ?? null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/event-notifications', () => ({
  dispatchEventNotificationsInBackground: vi.fn(),
}));
vi.mock('@/components/rich-text-editor', () => ({
  RichTextEditor: ({ value }: { value: string }) => (
    <div data-testid="tournament-rules-editor" data-value={value} />
  ),
}));

describe('EventManagementForm organizer assignment', () => {
  const organizerOptions = [
    { id: 'admin-1', full_name: 'Alex Admin', email: 'alex@example.com', role: 'admin' },
    {
      id: 'organizer-1',
      full_name: 'Jordan Organizer',
      email: 'jordan@example.com',
      role: 'organizer',
    },
  ];

  it('defaults the admin-created event to the current administrator', () => {
    render(
      <EventManagementForm
        currentUserId="admin-1"
        organizerOptions={organizerOptions}
        showOrganizerField
      />,
    );

    const organizer = screen.getByLabelText('Organizer') as HTMLSelectElement;
    expect(organizer.value).toBe('admin-1');
    expect(
      screen.getByRole('option', { name: 'Jordan Organizer (organizer)' }),
    ).toBeInTheDocument();
  });

  it('does not render an organizer selector when the caller is an organizer', () => {
    render(<EventManagementForm currentUserId="organizer-1" />);
    expect(screen.queryByLabelText('Organizer')).not.toBeInTheDocument();
  });
});

describe('Social Doubles Ladder ranking criteria controls', () => {
  it('uses selected and available boxes and supports adding, removing, and reordering criteria', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'social_doubles_ladder');
    expect(
      screen.getByText(
        'This is a unique name. It will aggregate results of all events associated with this ladder',
      ),
    ).toBeInTheDocument();

    const selected = screen.getByRole('list', { name: 'Ladder ranking priorities' });
    const initial = Array.from(selected.querySelectorAll('li')).map(
      (row) => row.dataset.ladderRankingKey,
    );
    expect(initial).toEqual(['games_won', 'sets_won', 'games_difference']);
    expect(screen.getByText('Available options')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add Sets difference priority' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Sets difference priority' }));
    expect(
      selected.querySelector('[data-ladder-ranking-key="sets_difference"]'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Sets won priority' }));
    expect(selected.querySelector('[data-ladder-ranking-key="sets_won"]')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move Games difference up' }));
    const reordered = Array.from(selected.querySelectorAll('li')).map(
      (row) => row.dataset.ladderRankingKey,
    );
    expect(reordered.indexOf('games_difference')).toBeLessThan(reordered.indexOf('games_won'));
  });
});

describe('tournament configuration controls', () => {
  it('configures League as one gender and a single round-robin group while keeping group standings priorities', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'league_tournament');

    const leagueConfiguration = screen.getByRole('heading', { name: 'League configuration' });
    const leagueName = screen.getByLabelText('League name');
    const leagueGender = screen.getByLabelText('League gender');
    const existingLeague = screen.getByLabelText('Associate with existing league (optional)');
    expect(
      screen.getByText(
        'This is a unique name. It will aggregate results of all events associated with this league',
      ),
    ).toBeInTheDocument();
    expect(leagueConfiguration.closest('section')).toContainElement(leagueName);
    expect(leagueConfiguration.closest('section')).toContainElement(existingLeague);
    expect(
      leagueGender.compareDocumentPosition(existingLeague) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      existingLeague.compareDocumentPosition(leagueName) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Tournament configuration' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Event type').closest('section')).not.toContainElement(leagueName);
    expect(screen.getByLabelText('Event type').closest('section')).toContainElement(
      screen.getByLabelText('Description'),
    );
    expect(screen.getByLabelText('Maximum attendees')).toBeInTheDocument();
    expect(leagueGender).toHaveValue('male');
    expect(screen.getByRole('button', { name: 'Series of events' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Repeat until')).toBeInTheDocument();
    const registrationOptions = screen.getByText('Registration options').closest('fieldset');
    expect(screen.queryByLabelText('Match scoring template')).not.toBeInTheDocument();
    expect(registrationOptions).toBeInTheDocument();
    expect(screen.queryByTestId('tournament-rules-editor')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Approximate match length for scheduling (minutes)'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Break between matches (minutes)')).not.toBeInTheDocument();
    expect(screen.queryByText('Enabled doubles categories and capacity')).not.toBeInTheDocument();
    expect(screen.queryByText('Group count')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Round robin')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Group ranking priorities' })).toBeInTheDocument();
    await user.selectOptions(leagueGender, 'female');
    expect(leagueGender).toHaveValue('female');
    await user.click(screen.getByRole('button', { name: 'Single event' }));
    expect(screen.getByLabelText('Event starts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeInTheDocument();
  });

  it('keeps team points first in the group ranking criteria and exposes advancement only for knockout', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'team_tournament');

    const rankingList = screen.getByRole('list', { name: 'Group ranking priorities' });
    expect(
      Array.from(rankingList.querySelectorAll('li')).map((item) => item.dataset.rankingKey)[0],
    ).toBe('points');
    expect(screen.getByText('Teams promoted from each group')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Points' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move Games won up' }));
    const reordered = Array.from(rankingList.querySelectorAll('li')).map(
      (item) => item.dataset.rankingKey,
    );
    expect(reordered[0]).toBe('points');
    expect(reordered.indexOf('games_won')).toBeLessThan(reordered.indexOf('sets_won'));

    await user.click(screen.getByRole('checkbox', { name: 'Team knockout' }));
    expect(screen.queryByText('Teams promoted from each group')).not.toBeInTheDocument();
  });

  it('allows all ranking criteria to be reordered and stores the resulting priority order', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'doubles_tournament');

    const rankingList = screen.getByRole('list', { name: 'Group ranking priorities' });
    const initial = Array.from(rankingList.querySelectorAll('li')).map(
      (row) => row.dataset.rankingKey,
    );
    expect(initial).toHaveLength(3);
    expect(initial[0]).toBe('matches_won');
    await user.click(screen.getByRole('button', { name: 'Move Games won up' }));
    const reordered = Array.from(rankingList.querySelectorAll('li')).map(
      (row) => row.dataset.rankingKey,
    );
    expect(reordered).toEqual(['matches_won', 'games_won', 'sets_won']);
    expect(screen.getByText(/Drag criteria into the order you want/i)).toBeInTheDocument();

    const rows = Array.from(rankingList.querySelectorAll('li'));
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type] ?? '';
      },
      effectAllowed: 'move',
    };
    fireEvent.dragStart(rows[0], { dataTransfer });
    fireEvent.dragOver(rows[2], { dataTransfer });
    fireEvent.drop(rows[2], { dataTransfer });
    const dragged = Array.from(rankingList.querySelectorAll('li')).map(
      (row) => row.dataset.rankingKey,
    );
    expect(dragged.indexOf('matches_won')).toBe(2);

    const availableHeading = screen.getByText('Available options');
    const availableBox = availableHeading.parentElement as HTMLElement;
    const selectedBox = rankingList.parentElement as HTMLElement;
    const selectedRow = rankingList.querySelector(
      '[data-ranking-key="matches_won"]',
    ) as HTMLElement;
    fireEvent.dragStart(selectedRow, { dataTransfer });
    fireEvent.dragOver(availableBox, { dataTransfer });
    fireEvent.drop(availableBox, { dataTransfer });
    expect(rankingList.querySelector('[data-ranking-key="matches_won"]')).not.toBeInTheDocument();

    const availableRow = availableBox.querySelector('li[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(availableRow, { dataTransfer });
    fireEvent.dragOver(selectedBox, { dataTransfer });
    fireEvent.drop(selectedBox, { dataTransfer });
    expect(rankingList.querySelector('[data-ranking-key="matches_won"]')).toBeInTheDocument();
  });

  it('hides group ranking priorities when round robin is disabled', () => {
    render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          event_type: 'tournament',
          tournament_format: 'doubles',
          tournament_config: {
            categories: ['mixed'],
            phases: { round_robin: false, preliminary_knockout: false, final_knockout: true },
          },
        }}
      />,
    );
    expect(
      screen.queryByRole('list', { name: 'Group ranking priorities' }),
    ).not.toBeInTheDocument();
  });

  it('shows supported scoring templates and the clarified field descriptions', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'doubles_tournament');
    expect(screen.getByText('Teams per group')).toBeInTheDocument();
    expect(screen.getByText('Individually')).toBeInTheDocument();
    expect(screen.getByText('With partner')).toBeInTheDocument();
    expect(screen.getByText('Organizer will pair players.')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Approximate match length for scheduling (minutes)'),
    ).toBeInTheDocument();
    const scoring = screen.getByRole('combobox', { name: 'Round robin' });
    expect(scoring).toHaveDisplayValue('Best of three sets');
    expect(
      screen.queryByRole('option', { name: /Two sets; play a deciding third set if split 1–1/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Add text version of the rules here.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate rules text' }));
    expect(screen.getByTestId('tournament-rules-editor').getAttribute('data-value')).toContain(
      'Doubles tournament',
    );
    expect(screen.getByTestId('tournament-rules-editor').getAttribute('data-value')).toContain(
      'Who can register',
    );
    expect(screen.queryByText('Alphabetical fallback')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Event type'), 'team_tournament');
    expect(screen.getByText(/Points/)).toBeInTheDocument();
    expect(
      screen.getAllByRole('option', { name: /third set awards team points/i }),
    ).not.toHaveLength(0);
    expect(screen.getByText(/Points/)).toBeInTheDocument();
  });

  it('generates rules for configured categories, phase scoring, eligibility, and advancement', async () => {
    const user = userEvent.setup();
    render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          event_type: 'tournament',
          tournament_format: 'doubles',
          tournament_config: {
            categories: ['men', 'women', 'mixed'],
            registration_mode: 'doubles',
            promoted_teams_per_group: 1,
            phases: {
              round_robin: true,
              preliminary_knockout: true,
              final_knockout: true,
            },
            scoring_templates: {
              round_robin: 'one_set',
              preliminary_knockout: 'two_sets_then_third',
              final_knockout: 'unknown_template',
            },
          },
          starts_at: '2030-06-01T10:00:00Z',
          ends_at: '2030-06-01T18:00:00Z',
          price_cents: 2000,
          allow_non_member_registration: true,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Generate rules text' }));
    const generated =
      screen.getByTestId('tournament-rules-editor').getAttribute('data-value') || '';
    expect(generated).toContain('Doubles tournament');
    expect(generated).toContain("men's doubles, women's doubles, mixed doubles");
    expect(generated).toContain('Players register with a partner.');
    expect(generated).toContain('Eligible members and non-members may register');
    expect(generated).toContain('Round robin: one set');
    expect(generated).toContain('Preliminary knockout: best of three sets');
    expect(generated).toContain('Final knockout: best of three sets');
    expect(generated).toContain('top 1 teams from each group advance');
    expect(generated).toContain('Dates:');
  });

  it('generates safe defaults for an incomplete team tournament rules draft', async () => {
    const user = userEvent.setup();
    render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          event_type: 'tournament',
          tournament_format: 'team',
          tournament_config: {
            registration_mode: 'single',
            scoring_template: 'unsupported-template',
          },
          allow_non_member_registration: false,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Generate rules text' }));
    const generated =
      screen.getByTestId('tournament-rules-editor').getAttribute('data-value') || '';
    expect(generated).toContain('Team tournament');
    expect(generated).toContain(
      'Players register individually and the organizer assigns partners.',
    );
    expect(generated).toContain('Registration is limited to eligible club members');
    expect(generated).toContain('best of three sets');
    expect(generated).not.toContain('Eligible categories:');
    expect(generated).not.toContain('Competition phases:');
  });
});

describe('event creation validation visibility', () => {
  beforeEach(() => {
    eventFormMocks.inserts = [];
    eventFormMocks.updates = [];
    eventFormMocks.readRows = {};
    eventFormMocks.errors = {};
  });
  async function submitAndExpectError(expected: string) {
    const form = screen
      .getByRole('button', { name: /Create (event|events|tournament)/ })
      .closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  }

  function setValidEventWindow(tournament = false) {
    const startsLabel = tournament ? 'Tournament starts' : 'Event starts';
    const endsLabel = tournament ? 'Tournament ends' : 'Event ends';
    const starts = screen.queryByLabelText(startsLabel) ?? screen.getByLabelText('Session starts');
    const ends = screen.queryByLabelText(endsLabel) ?? screen.getByLabelText('Session ends');
    fireEvent.change(starts, { target: { value: '2027-06-01T10:00' } });
    fireEvent.change(ends, { target: { value: '2027-06-01T12:00' } });
    fireEvent.change(screen.getByLabelText('Registration opens'), {
      target: { value: '2027-05-01T10:00' },
    });
    fireEvent.change(screen.getByLabelText('Registration cutoff'), {
      target: { value: '2027-05-31T10:00' },
    });
  }

  function setValidSeriesWindow() {
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-06-01' } });
    fireEvent.change(screen.getByLabelText('Repeat until'), { target: { value: '2027-08-31' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '12:00' } });
  }

  it('shows registration cutoff validation in an alert near the top of the form', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Validation Test' },
    });
    fireEvent.change(screen.getByLabelText('Event starts'), {
      target: { value: '2027-06-01T10:00' },
    });
    fireEvent.change(screen.getByLabelText('Event ends'), {
      target: { value: '2027-06-01T12:00' },
    });
    fireEvent.change(screen.getByLabelText('Registration opens'), {
      target: { value: '2027-05-01T10:00' },
    });
    fireEvent.change(screen.getByLabelText('Registration cutoff'), {
      target: { value: '2027-06-02T10:00' },
    });
    await user.click(screen.getByRole('button', { name: /Create (event|events|tournament)/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Registration cutoff must be on or before the event start.',
    );
  });

  it('creates a single social event with the configured registration window', async () => {
    render(<EventManagementForm currentUserId="admin-1" />);
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Summer social' } });
    setValidEventWindow();
    const form = screen
      .getByRole('button', { name: 'Create event' })
      .closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 event created.'));
    const created = eventFormMocks.inserts.find((write) => write.table === 'events')?.values;
    expect(created).toEqual([
      expect.objectContaining({
        title: 'Summer social',
        starts_at: expect.any(String),
        ends_at: expect.any(String),
        registration_opens_at: expect.any(String),
        registration_closes_at: expect.any(String),
        series_id: null,
      }),
    ]);
  });

  it('updates shared recurring-event fields and individual dates when cancelling a series event', async () => {
    const user = userEvent.setup();
    render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          id: 'event-edit',
          series_id: 'series-edit',
          event_type: 'social',
          title: 'Original title',
          starts_at: '2027-06-01T10:00:00.000Z',
          ends_at: '2027-06-01T12:00:00.000Z',
          registration_opens_at: '2027-05-01T10:00:00.000Z',
          registration_closes_at: '2027-05-31T10:00:00.000Z',
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Cancelled event' },
    });
    fireEvent.change(screen.getByLabelText('Publication'), { target: { value: 'cancelled' } });
    setValidEventWindow();
    await user.click(screen.getByLabelText(/Apply shared fields to all recurring events/));
    const form = screen
      .getByRole('button', { name: 'Save event changes' })
      .closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Shared fields updated across the recurring series.',
      ),
    );
    const eventUpdates = eventFormMocks.updates.filter((write) => write.table === 'events');
    expect(eventUpdates).toHaveLength(2);
    expect(eventUpdates[0].values).toMatchObject({ title: 'Cancelled event', status: 'cancelled' });
    expect(eventUpdates[1].values).toMatchObject({
      starts_at: expect.any(String),
      registration_closes_at: expect.any(String),
    });
  });

  it('creates a recurring League series and links its events to the new League', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'league_tournament');
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Summer League' } });
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Summer League' } });
    setValidSeriesWindow();
    const form = screen
      .getByRole('button', { name: 'Create events' })
      .closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/\d+ events created\./),
    );
    expect(eventFormMocks.inserts).toContainEqual(
      expect.objectContaining({
        table: 'event_series',
        values: expect.objectContaining({
          created_by: 'admin-1',
          recurrence_rule: expect.objectContaining({ frequency: 'weekly' }),
        }),
      }),
    );
    expect(eventFormMocks.inserts).toContainEqual(
      expect.objectContaining({
        table: 'social_doubles_ladders',
        values: expect.objectContaining({ competition_type: 'league', name: 'Summer League' }),
      }),
    );
    expect(eventFormMocks.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'social_doubles_ladders' }),
        expect.objectContaining({ table: 'events' }),
      ]),
    );
  });

  it.each([
    ['weekly', 13],
    ['biweekly', 7],
    ['monthly', 3],
  ])(
    'creates the expected recurring social sessions for %s frequency',
    async (frequency, count) => {
      const user = userEvent.setup();
      render(<EventManagementForm currentUserId="admin-1" />);
      fireEvent.change(screen.getByLabelText('Event title'), {
        target: { value: 'Summer social' },
      });
      await user.click(screen.getByRole('button', { name: 'Series of events' }));
      setValidSeriesWindow();
      await user.selectOptions(screen.getByLabelText('Repeat'), frequency);
      fireEvent.submit(
        screen.getByRole('button', { name: 'Create events' }).closest('form') as HTMLFormElement,
      );

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(`${count} events created.`),
      );
      const createdEvents = eventFormMocks.inserts.find(
        (write) => write.table === 'events',
      )?.values;
      expect(createdEvents).toHaveLength(count);
      expect(eventFormMocks.inserts).toContainEqual(
        expect.objectContaining({
          table: 'event_series',
          values: expect.objectContaining({
            recurrence_rule: expect.objectContaining({ frequency }),
          }),
        }),
      );
    },
  );

  it('rejects reversed and excessively long recurring social event ranges', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Long social series' },
    });
    await user.click(screen.getByRole('button', { name: 'Series of events' }));
    setValidSeriesWindow();
    fireEvent.change(screen.getByLabelText('Repeat until'), { target: { value: '2027-05-31' } });
    await submitAndExpectError('Repeat-until date must be on or after the first event.');

    fireEvent.change(screen.getByLabelText('Repeat until'), { target: { value: '2040-06-01' } });
    await submitAndExpectError('The recurrence range is too long.');
  });

  it('reports a social event insert failure and clears the busy state', async () => {
    eventFormMocks.errors['events.insert.then'] = new Error('Event storage failed.');
    render(<EventManagementForm currentUserId="admin-1" />);
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Summer social' } });
    setValidEventWindow();
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create event' }).closest('form') as HTMLFormElement,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Event storage failed.');
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
  });

  it('creates a new ladder and associates created event rows with it', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'social_doubles_ladder');
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Ladder night' } });
    fireEvent.change(screen.getByLabelText('Ladder name'), { target: { value: 'Summer ladder' } });
    setValidSeriesWindow();
    const form = screen
      .getByRole('button', { name: 'Create events' })
      .closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/\d+ events created\./),
    );
    expect(eventFormMocks.inserts).toContainEqual(
      expect.objectContaining({
        table: 'social_doubles_ladders',
        values: expect.objectContaining({ name: 'Summer ladder', gender: 'male' }),
      }),
    );
    expect(eventFormMocks.updates).toContainEqual(expect.objectContaining({ table: 'events' }));
  });

  it('carries prior ladder results forward into player seeds', async () => {
    eventFormMocks.readRows.social_doubles_ladders = [
      {
        id: 'previous-ladder',
        name: 'Previous ladder',
        gender: 'male',
        position_points: [2, 1, -1, -2],
        ranking_priority: ['games_won', 'sets_won', 'games_difference'],
        competition_type: 'social_doubles_ladder',
      },
    ];
    eventFormMocks.readRows.events = [{ id: 'previous-event' }];
    eventFormMocks.readRows.event_scores = [
      {
        event_id: 'previous-event',
        player_one_registration_id: 'reg-a',
        player_two_registration_id: 'reg-b',
        player_three_registration_id: 'reg-c',
        player_four_registration_id: 'reg-d',
        player_one_score: 6,
        player_two_score: 3,
      },
    ];
    eventFormMocks.readRows.registrations = [
      { id: 'reg-a', user_id: 'player-a' },
      { id: 'reg-b', user_id: 'player-b' },
      { id: 'reg-c', user_id: 'player-c' },
      { id: 'reg-d', user_id: 'player-d' },
    ];
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'social_doubles_ladder');
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'New ladder event' },
    });
    fireEvent.change(screen.getByLabelText('Ladder name'), { target: { value: 'New ladder' } });
    setValidSeriesWindow();
    await user.selectOptions(screen.getByLabelText('Previous ladder carryover'), 'full');
    await user.selectOptions(screen.getByLabelText('Previous ladder'), 'previous-ladder');
    const form = screen
      .getByRole('button', { name: 'Create events' })
      .closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() =>
      expect(
        eventFormMocks.inserts.some((write) => write.table === 'social_doubles_ladder_seeds'),
      ).toBe(true),
    );
    const seeds = eventFormMocks.inserts.find(
      (write) => write.table === 'social_doubles_ladder_seeds',
    )?.values;
    expect(seeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ladder_id: 'created-social_doubles_ladders' }),
      ]),
    );
  });

  it('validates event timing and registration window boundaries', async () => {
    render(<EventManagementForm currentUserId="admin-1" />);
    const start = screen.getByLabelText('Event starts');
    const end = screen.getByLabelText('Event ends');
    const opens = screen.getByLabelText('Registration opens');
    const closes = screen.getByLabelText('Registration cutoff');

    fireEvent.change(start, { target: { value: '2027-06-01T10:00' } });
    fireEvent.change(end, { target: { value: '2027-06-01T10:00' } });
    await submitAndExpectError('The event end must be after the start time.');

    fireEvent.change(end, { target: { value: '2027-06-01T12:00' } });
    await submitAndExpectError('Set a registration cutoff date and time.');

    fireEvent.change(opens, { target: { value: '2027-06-01T10:00' } });
    fireEvent.change(closes, { target: { value: '2027-05-31T10:00' } });
    await submitAndExpectError('Registration must open before the event starts.');

    fireEvent.change(opens, { target: { value: '2027-05-31T11:00' } });
    await submitAndExpectError('Registration cutoff must be after registration opens.');
  });

  it('rejects invalid tournament category and phase configurations', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'doubles_tournament');
    setValidEventWindow(true);
    const categoryOptions = screen
      .getByRole('group', { name: 'Enabled doubles categories and capacity' })
      .querySelectorAll('input[type="checkbox"]');
    for (const checkbox of categoryOptions) fireEvent.click(checkbox);
    await submitAndExpectError('Enable at least one doubles category.');
  });

  it('validates knockout phases, per-category capacity, and ordinary event capacity', async () => {
    const { unmount } = render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          event_type: 'tournament',
          tournament_format: 'doubles',
          tournament_config: {
            categories: ['mixed'],
            phases: { round_robin: false, preliminary_knockout: true, final_knockout: true },
          },
        }}
      />,
    );
    setValidEventWindow(true);
    const phaseOptions = screen
      .getByRole('group', { name: 'Competition phases and scoring templates' })
      .querySelectorAll('input[type="checkbox"]');
    await submitAndExpectError('Preliminary knockout requires round robin.');

    fireEvent.click(phaseOptions[1]);
    fireEvent.change(screen.getByLabelText('Mixed doubles', { selector: 'input[type="number"]' }), {
      target: { value: '1.5' },
    });
    await submitAndExpectError('Capacity for mixed must be a positive whole number or left blank.');

    unmount();
    render(<EventManagementForm currentUserId="admin-1" />);
    fireEvent.change(screen.getByLabelText('Maximum attendees'), { target: { value: '0' } });
    setValidEventWindow();
    await submitAndExpectError('Maximum attendees must be at least 1.');
  });

  it('validates ladder gender, name, ranking criteria, and previous-ladder carryover', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'social_doubles_ladder');
    setValidSeriesWindow();
    fireEvent.change(screen.getByLabelText('Ladder gender'), { target: { value: '' } });
    await submitAndExpectError("Choose men's or women's ladder.");

    fireEvent.change(screen.getByLabelText('Ladder gender'), { target: { value: 'male' } });
    fireEvent.change(screen.getByLabelText('Ladder name'), { target: { value: '   ' } });
    await submitAndExpectError('Enter a name for this ladder.');

    fireEvent.change(screen.getByLabelText('Ladder name'), { target: { value: 'Summer ladder' } });
    const selected = screen.getByRole('list', { name: 'Ladder ranking priorities' });
    for (const button of Array.from(selected.querySelectorAll('button[aria-label^="Remove"]')))
      fireEvent.click(button);
    await submitAndExpectError('Choose at least one ranking criterion.');

    await user.click(screen.getByRole('button', { name: 'Add Sets won priority' }));
    await user.selectOptions(screen.getByLabelText('Previous ladder carryover'), 'full');
    await submitAndExpectError('Choose a previous ladder for carryover.');
  });

  it('rejects a duplicate ladder name without creating a second ladder', async () => {
    eventFormMocks.readRows.social_doubles_ladders = [
      {
        id: 'existing-ladder',
        name: 'Summer Ladder',
        gender: 'male',
        ends_at: null,
        position_points: [2, 1, -1, -2],
        ranking_priority: ['games_won'],
      },
    ];
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(await screen.findByLabelText('Event type'), 'social_doubles_ladder');
    await screen.findByRole('option', { name: 'Summer Ladder' });
    setValidSeriesWindow();
    fireEvent.change(screen.getByLabelText('Ladder name'), {
      target: { value: ' summer ladder ' },
    });

    await submitAndExpectError(
      'A ladder with this name already exists. Choose a unique ladder name.',
    );
    expect(eventFormMocks.inserts).toEqual([]);
  });

  it('requires a name when creating a League', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'league_tournament');
    setValidSeriesWindow();
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: '' } });
    await submitAndExpectError('Enter a name for this league.');
  });

  it('reports a missing start date for a recurring ladder series', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'social_doubles_ladder');
    await submitAndExpectError('Choose a start date for the event series.');

    setValidSeriesWindow();
    await submitAndExpectError('Enter a name for this ladder.');
  });

  it('requires a gender when creating a League series', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'league_tournament');
    setValidSeriesWindow();
    fireEvent.change(screen.getByLabelText('League gender'), { target: { value: '' } });
    await submitAndExpectError('Choose a league gender.');
  });

  it('keeps the gender fixed when an existing ladder or League is selected', async () => {
    eventFormMocks.readRows.social_doubles_ladders = [
      {
        id: 'men-ladder',
        name: 'Men ladder',
        gender: 'male',
        competition_type: 'ladder',
        ends_at: null,
        position_points: [2, 1, -1, -2],
        ranking_priority: ['games_won'],
      },
      {
        id: 'men-league',
        name: 'Men League',
        gender: 'male',
        competition_type: 'league',
        ends_at: null,
        position_points: [2, 1, -1, -2],
        ranking_priority: ['points'],
      },
    ];
    const user = userEvent.setup();
    const { unmount } = render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(await screen.findByLabelText('Event type'), 'social_doubles_ladder');
    await user.selectOptions(
      screen.getByLabelText('Associate with existing ladder (optional)'),
      'men-ladder',
    );
    fireEvent.change(screen.getByLabelText('Ladder gender'), { target: { value: 'female' } });
    setValidSeriesWindow();
    await submitAndExpectError('A ladder cannot mix gender categories.');

    unmount();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(await screen.findByLabelText('Event type'), 'league_tournament');
    await user.selectOptions(
      screen.getByLabelText('Associate with existing league (optional)'),
      'men-league',
    );
    fireEvent.change(screen.getByLabelText('League gender'), { target: { value: 'female' } });
    expect(screen.getByLabelText('Associate with existing league (optional)')).toHaveValue('');
    expect(screen.getByLabelText('League name')).toBeInTheDocument();
  });
});

describe('tournament basic information fields', () => {
  it('hides social-event-only fields and disables member-only requirement for tournaments', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'doubles_tournament');
    expect(
      screen.queryByLabelText('Participant gender restriction (optional)'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(screen.queryByText('Active paid membership required')).not.toBeInTheDocument();
  });
});

describe('event series scheduling', () => {
  it('replaces the repeat checkbox with a single-event/series switch and live registration date previews', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);

    expect(screen.queryByLabelText('Repeat this event')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Single event' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Series of events' }));

    expect(screen.queryByLabelText('Session starts')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Day of week')).toBeInTheDocument();
    expect(screen.getByLabelText('Start time')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-06-01' } });
    fireEvent.change(screen.getByLabelText('Day of week'), { target: { value: '6' } });
    expect(screen.getByText(/Registration opens on/).textContent).toContain('Wednesday');

    fireEvent.change(screen.getByLabelText('Day of week'), { target: { value: '1' } });
    expect(screen.getByText(/Registration opens on/).textContent).toContain('Friday');
    expect(screen.getByText(/Registration closes on/).textContent).toContain('Sunday');
  });

  it('omits empty dates from generated tournament rules', async () => {
    const user = userEvent.setup();
    render(<EventManagementForm currentUserId="admin-1" />);
    await user.selectOptions(screen.getByLabelText('Event type'), 'doubles_tournament');
    await user.click(screen.getByRole('button', { name: 'Generate rules text' }));
    const generated =
      screen.getByTestId('tournament-rules-editor').getAttribute('data-value') || '';
    expect(generated).not.toContain('To be announced');
    expect(generated).not.toContain('Dates:');
  });
  it('places the single-event/series switch inside Scheduling and uses event wording for social events', () => {
    render(<EventManagementForm currentUserId="admin-1" />);
    const scheduling = screen.getByRole('heading', { name: 'Scheduling' }).parentElement
      ?.parentElement;
    expect(scheduling).toBeTruthy();
    expect(scheduling).toContainElement(
      screen.getByRole('group', { name: 'Event scheduling type' }),
    );
    expect(screen.getByLabelText('Event starts')).toBeInTheDocument();
    expect(screen.queryByText('Repeat this event')).not.toBeInTheDocument();
  });

  it('shows the promoted-team setting only when round robin and final knockout are enabled', () => {
    const { unmount } = render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          event_type: 'tournament',
          tournament_format: 'doubles',
          tournament_config: {
            categories: ['mixed'],
            phases: { round_robin: true, final_knockout: true },
            group_count: 2,
            teams_per_group: 4,
          },
        }}
      />,
    );
    expect(screen.getByText('Teams promoted from each group')).toBeInTheDocument();
    unmount();
    render(
      <EventManagementForm
        currentUserId="admin-1"
        event={{
          event_type: 'tournament',
          tournament_format: 'doubles',
          tournament_config: {
            categories: ['mixed'],
            phases: { round_robin: true, final_knockout: false },
            group_count: 2,
            teams_per_group: 4,
          },
        }}
      />,
    );
    expect(screen.queryByText('Teams promoted from each group')).not.toBeInTheDocument();
  });
});
