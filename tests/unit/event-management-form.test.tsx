import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventManagementForm } from '@/components/event-management-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return query;
    },
  }),
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
});

describe('event creation validation visibility', () => {
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
