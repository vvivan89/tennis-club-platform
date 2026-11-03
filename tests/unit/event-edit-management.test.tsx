import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  queryRows: {} as Record<string, unknown[][]>,
  queryErrors: {} as Record<string, { message: string }>,
  singleRows: {} as Record<string, unknown>,
  rpcRows: {} as Record<string, unknown>,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        gte: () => query,
        lte: () => query,
        or: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data: mocks.singleRows[table] ?? null,
          error: mocks.queryErrors[table] ?? null,
        }),
        then: (
          resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          const result = mocks.queryRows[table]?.shift() ?? [];
          return Promise.resolve({ data: result, error: mocks.queryErrors[table] ?? null }).then(
            resolve,
            reject,
          );
        },
      };
      return query;
    },
    channel: () => ({ on: () => ({ subscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  }),
}));

import { EventEditManagement } from '@/components/event-edit-management';

const participants = [
  {
    id: 'player-1',
    full_name: 'Alex Chen',
    avatar_url: null,
    email: 'alex@example.com',
    phone: null,
    tennis_skill_level: 3.5,
    suspended: false,
  },
  {
    id: 'player-2',
    full_name: 'Jordan Lee',
    avatar_url: null,
    email: 'jordan@example.com',
    phone: null,
    tennis_skill_level: 4,
    suspended: false,
  },
  {
    id: 'player-3',
    full_name: 'Taylor Wong',
    avatar_url: null,
    email: 'taylor@example.com',
    phone: null,
    tennis_skill_level: 3,
    suspended: true,
  },
  {
    id: 'player-4',
    full_name: 'Morgan Park',
    avatar_url: null,
    email: 'morgan@example.com',
    phone: null,
    tennis_skill_level: 3.5,
    suspended: true,
  },
];
const registrations = [
  {
    id: 'registration-1',
    user_id: 'player-1',
    status: 'confirmed',
    queue_position: null,
    created_at: '2026-01-01',
  },
  {
    id: 'registration-2',
    user_id: 'player-2',
    status: 'confirmed',
    queue_position: null,
    created_at: '2026-01-02',
  },
  {
    id: 'registration-3',
    user_id: 'player-3',
    status: 'waitlisted',
    queue_position: 3,
    created_at: '2026-01-03',
  },
];
const assignments = [
  { registration_id: 'registration-1', court_number: 1, segment_order: 1 },
  { registration_id: 'registration-2', court_number: 2, segment_order: 1 },
];

beforeEach(() => {
  mocks.queryRows = {
    registrations: [[...registrations], [...registrations]],
    event_court_assignments: [[...assignments]],
    event_scores: [[]],
  };
  mocks.queryErrors = {};
  mocks.singleRows = {};
  mocks.rpcRows = {};
  mocks.calls = [];
  mocks.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    mocks.calls.push({ name, args });
    if (name === 'event_member_directory') return { data: participants, error: null };
    return { data: null, error: null };
  });
  mocks.refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('EventEditManagement court assignments', () => {
  it('shows why gender-ineligible and unpaid members cannot be added', async () => {
    mocks.queryRows.registrations = [[], []];
    mocks.singleRows.events = { members_only: true, gender_restriction: 'female' };
    mocks.rpcRows.event_tournament_member_directory = participants.map((person) => ({
      id: person.id,
      gender: person.id === 'player-1' ? 'female' : person.id === 'player-2' ? 'male' : null,
    }));
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: participants, error: null };
      if (name === 'event_tournament_member_directory')
        return { data: mocks.rpcRows.event_tournament_member_directory, error: null };
      if (name === 'has_active_paid_membership')
        return { data: args.v_user === 'player-1', error: null };
      return { data: null, error: null };
    });

    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-eligibility" startsAt="2999-01-01T00:00:00Z" />);
    const selector = await screen.findByPlaceholderText('Select a member…');
    await user.click(selector);
    expect(screen.getByRole('option', { name: /Alex Chen/ })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Jordan Lee/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Taylor Wong/ })).toBeDisabled();
  });

  it('blocks members when paid-membership or gender eligibility cannot be verified', async () => {
    mocks.singleRows.events = { members_only: true };
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: participants, error: null };
      if (name === 'event_tournament_member_directory')
        return { data: participants.map((p) => ({ id: p.id, gender: null })), error: null };
      if (name === 'has_active_paid_membership')
        return { data: null, error: { message: 'Membership status unavailable.' } };
      return { data: null, error: null };
    });
    const first = render(<EventEditManagement eventId="event-membership-error" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not verify member eligibility',
    );
    first.unmount();

    mocks.singleRows.events = {};
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: participants, error: null };
      if (name === 'event_tournament_member_directory')
        return { data: null, error: { message: 'Gender directory unavailable.' } };
      return { data: null, error: null };
    });
    render(<EventEditManagement eventId="event-gender-error" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load member gender eligibility.',
    );
  });

  it('moves a player between courts and submits the complete assignment set once', async () => {
    const user = userEvent.setup();
    render(
      <EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" assignmentOnly />,
    );
    await user.click(await screen.findByRole('button', { name: 'Assign courts' }));
    expect(screen.getByRole('dialog', { name: 'Assign courts' })).toBeInTheDocument();

    const alexChip = screen.getByText('Alex Chen').closest('[draggable="true"]');
    const courtTwo = screen.getByText('Court 2').parentElement;
    expect(alexChip).not.toBeNull();
    expect(courtTwo).not.toBeNull();
    fireEvent.dragStart(alexChip as Element);
    fireEvent.drop(courtTwo as Element);
    expect(screen.getByText('Alex Chen').closest('[draggable="true"]')?.parentElement).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        mocks.calls.filter((call) => call.name === 'save_event_court_assignments'),
      ).toHaveLength(1),
    );
    const saved = mocks.calls.find((call) => call.name === 'save_event_court_assignments')?.args;
    expect(saved).toMatchObject({ p_event_id: 'event-1' });
    expect(saved?.p_assignments).toContainEqual({
      registration_id: 'registration-1',
      court_number: 2,
      segment_order: 1,
    });
    expect(saved?.p_assignments).toContainEqual({
      registration_id: 'registration-2',
      court_number: 2,
      segment_order: 1,
    });
    expect(screen.getByText('Court assignments saved.')).toBeInTheDocument();
  });

  it('locks assignment editing after the two-day cutoff', async () => {
    render(
      <EventEditManagement eventId="event-1" startsAt="2020-01-01T00:00:00Z" assignmentOnly />,
    );
    expect(await screen.findByText(/Court assignments are locked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign courts' })).not.toBeInTheDocument();
  });

  it('shows assignment balance warnings and safely reports roster load failures', async () => {
    mocks.queryRows.event_court_assignments = [
      [{ registration_id: 'registration-1', court_number: 1, segment_order: 1 }],
    ];
    const { unmount } = render(
      <EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />,
    );
    expect(await screen.findByText(/number of assigned sub-sessions differs/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Assign courts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Every confirmed participant must be assigned',
    );
    unmount();

    mocks.queryErrors.registrations = { message: 'Roster unavailable.' };
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load event management data.',
    );
  });

  it('reports a failed court assignment save without closing the editor', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: participants, error: null };
      if (name === 'save_event_court_assignments')
        return { data: null, error: { message: 'Assignment write denied.' } };
      return { data: null, error: null };
    });
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-save-error" startsAt="2999-01-01T00:00:00Z" />);
    await user.click(await screen.findByRole('button', { name: 'Assign courts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save court assignments.');
    expect(screen.getByRole('dialog', { name: 'Assign courts' })).toBeInTheDocument();
  });

  it('asks before saving an overfull court and saves when the warning is acknowledged', async () => {
    const confirmed = Array.from({ length: 5 }, (_, index) => ({
      id: `registration-${index + 1}`,
      user_id: `player-${index + 1}`,
      status: 'confirmed',
      queue_position: null,
      created_at: `2026-01-0${index + 1}`,
    }));
    mocks.queryRows.registrations = [confirmed, confirmed];
    mocks.queryRows.event_court_assignments = [
      confirmed.map((row) => ({
        registration_id: row.id,
        court_number: 1,
        segment_order: 1,
      })),
    ];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory')
        return {
          data: confirmed.map((row, index) => ({
            id: row.user_id,
            full_name: `Player ${index + 1}`,
            avatar_url: null,
            gender: null,
          })),
          error: null,
        };
      return { data: null, error: null };
    });
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-overfull" startsAt="2999-01-01T00:00:00Z" />);
    await user.click(await screen.findByRole('button', { name: 'Assign courts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const warning = await screen.findByRole('alertdialog');
    expect(warning).toHaveTextContent('Court 1 has 5 players (maximum 4)');
    expect(mocks.calls.some((call) => call.name === 'save_event_court_assignments')).toBe(false);

    await user.click(within(warning).getByRole('button', { name: 'Save anyway' }));
    await waitFor(() =>
      expect(mocks.calls.some((call) => call.name === 'save_event_court_assignments')).toBe(true),
    );
  });

  it('requires confirmation before adding a suspended member and reports the completed action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ failed: 0 }) }),
    );
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: participants, error: null };
      if (name === 'manage_event_registration')
        return {
          data: { registration_id: 'registration-4', registration_state: 'confirmed' },
          error: null,
        };
      return { data: null, error: null };
    });
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    const memberSelect = await screen.findByPlaceholderText('Select a member…');
    await user.click(memberSelect);
    await user.click(screen.getByRole('option', { name: /Morgan Park/ }));
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('suspended for the event date');
    expect(mocks.calls.some((call) => call.name === 'manage_event_registration')).toBe(false);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add member' }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.calls).toContainEqual({
      name: 'manage_event_registration',
      args: expect.objectContaining({ p_user_id: 'player-4', p_action: 'add' }),
    });
    expect(screen.getByRole('status')).toHaveTextContent('Member added or waitlisted.');
  });

  it('adds a member from the RPC row response and handles registration failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ failed: 0 }) }),
    );
    mocks.queryRows.registrations = [[], []];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: participants, error: null };
      if (name === 'manage_event_registration')
        return {
          data: [
            {
              registration_id: 'registration-new',
              registration_state: 'waitlisted',
              position_in_waitlist: 2,
            },
          ],
          error: null,
        };
      return { data: null, error: null };
    });
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    const memberSelect = await screen.findByPlaceholderText('Select a member…');
    await user.click(memberSelect);
    await user.click(screen.getByRole('option', { name: /Alex Chen/ }));
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('Member added or waitlisted.');

    cleanup();
    mocks.queryRows.registrations = [[], []];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: participants, error: null };
      if (name === 'manage_event_registration')
        return { data: null, error: { message: 'Registration was rejected.' } };
      return { data: null, error: null };
    });
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    const retrySelect = await screen.findByPlaceholderText('Select a member…');
    await user.click(retrySelect);
    await user.click(screen.getByRole('option', { name: /Alex Chen/ }));
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration was rejected.');
  });

  it('copies the current court layout into a new sub-session and saves both sessions', async () => {
    const user = userEvent.setup();
    render(
      <EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" assignmentOnly />,
    );
    await user.click(await screen.findByRole('button', { name: 'Assign courts' }));
    await user.click(screen.getByRole('button', { name: 'Add sub-session' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        mocks.calls.filter((call) => call.name === 'save_event_court_assignments'),
      ).toHaveLength(1),
    );
    const saved = mocks.calls.find((call) => call.name === 'save_event_court_assignments')?.args;
    expect(saved?.p_assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ registration_id: 'registration-1', segment_order: 1 }),
        expect.objectContaining({ registration_id: 'registration-2', segment_order: 1 }),
        expect.objectContaining({ registration_id: 'registration-1', segment_order: 2 }),
        expect.objectContaining({ registration_id: 'registration-2', segment_order: 2 }),
      ]),
    );
  });

  it('automatically assigns a ladder event using confirmed participants when there is no prior scoring', async () => {
    const confirmed = [
      { ...registrations[0], user_id: 'player-1' },
      { ...registrations[1], user_id: 'player-2' },
      {
        id: 'registration-4',
        user_id: 'player-4',
        status: 'confirmed',
        queue_position: null,
        created_at: '2026-01-04',
      },
    ];
    mocks.queryRows.registrations = [[...confirmed], [...confirmed]];
    mocks.singleRows.events = {
      event_type: 'social_doubles_ladder',
      social_doubles_ladder_id: 'ladder-1',
      ladder_ranking_priority: ['games_won', 'sets_won'],
      ladder_position_points: [2, 1, -1, -2],
      gender_restriction: 'male',
      members_only: false,
    };
    mocks.singleRows.social_doubles_ladders = { carryover_mode: 'position' };
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    await user.click(await screen.findByRole('button', { name: 'Assign courts' }));
    await user.click(screen.getByRole('button', { name: 'Automatic ladder assignment' }));
    expect(
      await screen.findByText(/Ladder courts assigned from current standings/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Current ladder ranking for registered players' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Alex Chen/).length).toBeGreaterThan(1);
  });

  it('orders automatic ladder courts from past scores and full carryover seeds', async () => {
    const confirmed = participants.map((person, index) => ({
      id: `reg-${index + 1}`,
      user_id: person.id,
      status: 'confirmed',
      queue_position: null,
      created_at: `2026-01-0${index + 1}`,
    }));
    mocks.queryRows.registrations = [
      confirmed,
      confirmed,
      confirmed.map((row) => ({ id: row.id, user_id: row.user_id })),
    ];
    mocks.queryRows.events = [[{ id: 'past-ladder-event' }]];
    mocks.queryRows.event_scores = [
      [],
      [
        {
          event_id: 'past-ladder-event',
          player_one_registration_id: 'reg-1',
          player_two_registration_id: 'reg-2',
          player_three_registration_id: 'reg-3',
          player_four_registration_id: 'reg-4',
          player_one_score: 6,
          player_two_score: 2,
        },
      ],
    ];
    mocks.queryRows.social_doubles_ladder_seeds = [
      [
        { user_id: 'player-3', initial_position: 1, initial_points: 8 },
        { user_id: 'player-4', initial_position: 2, initial_points: 2 },
      ],
    ];
    mocks.singleRows.events = {
      event_type: 'social_doubles_ladder',
      social_doubles_ladder_id: 'ladder-1',
      ladder_ranking_priority: ['games_won', 'games_difference', 'sets_won'],
      ladder_position_points: [3, 1, -1, -3],
      members_only: false,
    };
    mocks.singleRows.social_doubles_ladders = { carryover_mode: 'full' };
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    await user.click(await screen.findByRole('button', { name: 'Assign courts' }));
    await user.click(screen.getByRole('button', { name: 'Automatic ladder assignment' }));
    expect(
      await screen.findByText(/Ladder courts assigned from current standings/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/pts/).length).toBeGreaterThan(0);
  });

  it('requires manual assignment when a ladder roster exceeds four automatic courts', async () => {
    const roster = Array.from({ length: 17 }, (_, index) => ({
      id: `player-${index + 1}`,
      full_name: `Player ${index + 1}`,
      email: `player-${index + 1}@example.test`,
      gender: null,
      avatar_url: null,
      phone: null,
      tennis_skill_level: null,
    }));
    const confirmed = roster.map((player, index) => ({
      id: `reg-${index + 1}`,
      user_id: player.id,
      status: 'confirmed',
      queue_position: null,
      created_at: `2026-01-${String(index + 1).padStart(2, '0')}`,
    }));
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === 'event_member_directory') return { data: roster, error: null };
      return { data: [], error: null };
    });
    mocks.queryRows.registrations = [confirmed, confirmed];
    mocks.singleRows.events = {
      event_type: 'social_doubles_ladder',
      social_doubles_ladder_id: 'ladder-1',
      ladder_ranking_priority: ['games_won'],
      ladder_position_points: [2, 1, -1, -2],
      members_only: false,
    };
    mocks.singleRows.social_doubles_ladders = { carryover_mode: 'position' };
    const user = userEvent.setup();
    render(<EventEditManagement eventId="large-ladder" startsAt="2999-01-01T00:00:00Z" />);
    await user.click(await screen.findByRole('button', { name: 'Assign courts' }));
    await user.click(screen.getByRole('button', { name: 'Automatic ladder assignment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/up to four courts/);
  });

  it('hides registration management sections when tournament participants are managed separately', async () => {
    render(
      <EventEditManagement
        eventId="event-1"
        startsAt="2999-01-01T00:00:00Z"
        hideRegistrationManagement
      />,
    );
    expect(await screen.findByRole('button', { name: 'Assign courts' })).toBeInTheDocument();
    expect(screen.queryByText('Add or remove participants')).not.toBeInTheDocument();
    expect(screen.queryByText(/Registered participants/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Waitlist/)).not.toBeInTheDocument();
  });

  it('requires destructive confirmation before removing a court-assigned participant', async () => {
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    const alex = await screen.findByText('Alex Chen');
    const participantRow = alex.closest('.flex.flex-wrap.items-center.gap-3');
    expect(participantRow).not.toBeNull();
    await user.click(within(participantRow as HTMLElement).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Removing them will also remove their assignments',
    );
    expect(mocks.calls.every((call) => call.name !== 'manage_event_registration')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove participant' }));
    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        name: 'manage_event_registration',
        args: {
          p_event_id: 'event-1',
          p_user_id: 'player-1',
          p_action: 'remove',
          p_idempotency_key: expect.any(String),
        },
      }),
    );
    expect(screen.getByText('Member removed; the waitlist was updated.')).toBeInTheDocument();
  });

  it('warns before replacing a player with a suspended waitlisted member', async () => {
    const user = userEvent.setup();
    render(<EventEditManagement eventId="event-1" startsAt="2999-01-01T00:00:00Z" />);
    const alex = await screen.findByText('Alex Chen');
    const participantRow = alex.closest('.flex.flex-wrap.items-center.gap-3');
    expect(participantRow).not.toBeNull();
    const replacement = within(participantRow as HTMLElement).getByRole('combobox');
    await user.click(replacement);
    await user.type(replacement, 'Taylor');
    await user.click(screen.getByRole('option', { name: /Taylor Wong/ }));
    await user.click(
      within(participantRow as HTMLElement).getByRole('button', { name: 'Confirm' }),
    );

    const confirmation = await screen.findByRole('alertdialog');
    expect(confirmation).toHaveTextContent('waitlisted at position 3');
    expect(confirmation).toHaveTextContent('suspended for the event date');
    expect(mocks.calls.every((call) => call.name !== 'replace_event_participant')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Replace player' }));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        name: 'replace_event_participant',
        args: {
          p_event_id: 'event-1',
          p_old_user_id: 'player-1',
          p_new_user_id: 'player-3',
          p_idempotency_key: expect.any(String),
        },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Player replaced.');
  });
});
