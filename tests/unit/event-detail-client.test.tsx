import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  routerRefresh: vi.fn(),
  removeChannel: vi.fn(),
  fetch: vi.fn(),
  rows: {} as Record<string, unknown[]>,
  writes: [] as Array<{ table: string; operation: string; values: Record<string, unknown> }>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    rpc: mocks.rpc,
    from: mocks.from,
    channel: () => ({ on: () => ({ subscribe: vi.fn() }) }),
    removeChannel: mocks.removeChannel,
  }),
}));
vi.mock('@/components/event-weather', () => ({ EventWeather: () => null }));

import { EventDetailClient } from '@/components/event-detail-client';

function queryFor(table: string) {
  let operation = 'select';
  let values: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: () => query,
    neq: () => query,
    order: () => query,
    limit: () => query,
    update: (payload: Record<string, unknown>) => {
      operation = 'update';
      values = payload;
      mocks.writes.push({ table, operation, values });
      return query;
    },
    insert: (payload: Record<string, unknown>) => {
      operation = 'insert';
      values = payload;
      mocks.writes.push({ table, operation, values });
      return query;
    },
    then: (
      resolve: (value: { data: unknown[]; error: null }) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: mocks.rows[table] ?? [], error: null }).then(resolve, reject),
  };
  return query;
}

const event = {
  id: 'event-1',
  slug: 'summer-social',
  title: 'Summer Social',
  description: 'Club evening',
  gender_restriction: null,
  event_type: 'social',
  starts_at: new Date(Date.now() + 86400000).toISOString(),
  ends_at: new Date(Date.now() + 90000000).toISOString(),
  registration_opens_at: '2020-01-01T00:00:00Z',
  registration_closes_at: null,
  capacity: 12,
  price_cents: 0,
  members_only: false,
  status: 'published',
  location: 'Main courts',
  notes: '',
  waitlist_enabled: true,
  court_count: 4,
};

function renderClient(overrides: Partial<React.ComponentProps<typeof EventDetailClient>> = {}) {
  return render(
    <EventDetailClient
      event={event}
      roster={[]}
      courts={[]}
      scores={[]}
      currentUserId="member-1"
      currentRegistrationId={null}
      currentStatus={null}
      locationQuery="Main courts"
      isManager={false}
      canViewParticipants={false}
      remainingSpots={12}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mocks.from.mockImplementation((table: string) => queryFor(table));
  mocks.rpc.mockReset().mockResolvedValue({
    data: [{ registration_id: 'registration-1', registration_state: 'confirmed' }],
    error: null,
  });
  mocks.routerRefresh.mockReset();
  mocks.removeChannel.mockReset();
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ failed: 0 }) });
  mocks.rows = {};
  mocks.writes = [];
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('EventDetailClient registration workflow', () => {
  it('renders public event details and registers through the RPC', async () => {
    const user = userEvent.setup();
    renderClient();
    expect(screen.getByText('Club evening')).toBeInTheDocument();
    expect(screen.getByText('12 spots remaining')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('confirmed'));
    expect(mocks.rpc).toHaveBeenCalledWith(
      'register_for_event',
      expect.objectContaining({
        p_event_id: 'event-1',
        p_idempotency_key: expect.any(String),
      }),
    );
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  });

  it('requires confirmation before withdrawing and reports the database result', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    renderClient({ currentRegistrationId: 'registration-1', currentStatus: 'confirmed' });
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep my place' }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'withdraw_from_event',
        expect.objectContaining({
          p_registration_id: 'registration-1',
          p_idempotency_key: expect.any(String),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Registration withdrawn'),
    );
  });

  it('reports the waitlist position returned by the registration RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          registration_id: 'registration-waitlist',
          registration_state: 'waitlisted',
          position_in_waitlist: 3,
        },
      ],
      error: null,
    });
    const user = userEvent.setup();
    renderClient({ remainingSpots: 0 });
    await user.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added to the waitlist at position 3.',
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'register_for_event',
      expect.objectContaining({ p_event_id: 'event-1' }),
    );
  });

  it('saves a score only for the current player’s assigned singles court', async () => {
    const startedEvent = {
      ...event,
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const roster = [
      {
        registration_id: 'reg-1',
        user_id: 'member-1',
        status: 'confirmed',
        queue_position: null,
        full_name: 'Alex Member',
        avatar_url: null,
        tennis_skill_level: 3.5,
      },
      {
        registration_id: 'reg-2',
        user_id: 'member-2',
        status: 'confirmed',
        queue_position: null,
        full_name: 'Jordan Member',
        avatar_url: null,
        tennis_skill_level: 4,
      },
    ];
    const courts = [
      { registration_id: 'reg-1', court_number: 1, segment_order: 1 },
      { registration_id: 'reg-2', court_number: 1, segment_order: 1 },
    ];
    mocks.rows.event_court_assignments = courts;
    const user = userEvent.setup();
    renderClient({
      event: startedEvent,
      roster,
      courts,
      currentRegistrationId: 'reg-1',
      currentStatus: 'confirmed',
      canViewParticipants: true,
    });
    await user.selectOptions(screen.getByLabelText('Court / sub-session'), '1:1');
    await user.type(screen.getByLabelText('Your team score'), '6');
    await user.type(screen.getByLabelText("Opponents' score"), '4');
    fireEvent.submit(screen.getByText('Add a score').closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(mocks.writes).toContainEqual({
        table: 'event_scores',
        operation: 'insert',
        values: {
          event_id: 'event-1',
          player_one_registration_id: 'reg-1',
          player_two_registration_id: 'reg-2',
          player_three_registration_id: null,
          player_four_registration_id: null,
          player_one_score: 6,
          player_two_score: 4,
          entered_by: 'member-1',
        },
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Score saved.');
    expect(mocks.routerRefresh).toHaveBeenCalled();
  });

  it('requires a doubles partner and records the two opposing registrations', async () => {
    const startedEvent = {
      ...event,
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const roster = ['Alex', 'Jordan', 'Casey', 'Taylor'].map((name, index) => ({
      registration_id: `reg-${index + 1}`,
      user_id: `member-${index + 1}`,
      status: 'confirmed',
      queue_position: null,
      full_name: name,
      avatar_url: null,
      tennis_skill_level: null,
    }));
    const courts = roster.map((player) => ({
      registration_id: player.registration_id,
      court_number: 1,
      segment_order: 1,
    }));
    const user = userEvent.setup();
    renderClient({
      event: startedEvent,
      roster,
      courts,
      currentRegistrationId: 'reg-1',
      currentStatus: 'confirmed',
      canViewParticipants: true,
    });
    await user.selectOptions(screen.getByLabelText('Court / sub-session'), '1:1');
    await user.type(screen.getByLabelText('Your team score'), '7');
    await user.type(screen.getByLabelText("Opponents' score"), '5');
    fireEvent.submit(screen.getByText('Add a score').closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('Select your partner.');
    expect(mocks.writes).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText('Partner'), 'reg-2');
    fireEvent.submit(screen.getByText('Add a score').closest('form') as HTMLFormElement);
    await waitFor(() =>
      expect(mocks.writes).toContainEqual({
        table: 'event_scores',
        operation: 'insert',
        values: expect.objectContaining({
          player_one_registration_id: 'reg-1',
          player_two_registration_id: 'reg-2',
          player_three_registration_id: 'reg-3',
          player_four_registration_id: 'reg-4',
          player_one_score: 7,
          player_two_score: 5,
        }),
      }),
    );
  });

  it('rejects score entry when the assigned court has fewer than two players', async () => {
    const startedEvent = {
      ...event,
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const roster = [
      {
        registration_id: 'reg-1',
        user_id: 'member-1',
        status: 'confirmed',
        queue_position: null,
        full_name: 'Alex Member',
        avatar_url: null,
        tennis_skill_level: null,
      },
    ];
    const courts = [{ registration_id: 'reg-1', court_number: 1, segment_order: 1 }];
    const user = userEvent.setup();
    renderClient({
      event: startedEvent,
      roster,
      courts,
      currentRegistrationId: 'reg-1',
      currentStatus: 'confirmed',
      canViewParticipants: true,
    });
    await user.selectOptions(await screen.findByLabelText('Court / sub-session'), '1:1');
    await user.type(screen.getByLabelText('Your team score'), '6');
    await user.type(screen.getByLabelText("Opponents' score"), '2');
    fireEvent.submit(screen.getByText('Add a score').closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scores can be entered when exactly two or four players are assigned',
    );
    expect(mocks.writes).toHaveLength(0);
  });

  it('surfaces safe errors when registration and withdrawal RPCs fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const user = userEvent.setup();
    const { rerender } = renderClient();
    await user.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update registration. Please try again.',
    );
    expect(screen.queryByText('private database detail')).not.toBeInTheDocument();

    rerender(
      <EventDetailClient
        event={event}
        roster={[]}
        courts={[]}
        scores={[]}
        currentUserId="member-1"
        currentRegistrationId="registration-1"
        currentStatus="confirmed"
        locationQuery="Main courts"
        isManager={false}
        canViewParticipants={false}
        remainingSpots={12}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update registration. Please try again.',
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'withdraw_from_event',
      expect.objectContaining({ p_registration_id: 'registration-1' }),
    );
  });

  it('allows a manager to edit a score recorded within the correction window', async () => {
    const recentEvent = {
      ...event,
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const score = {
      id: 'score-1',
      player_one_registration_id: 'reg-1',
      player_two_registration_id: 'reg-2',
      player_three_registration_id: null,
      player_four_registration_id: null,
      player_one_score: 6,
      player_two_score: 3,
      player_one_name: 'Alex Member',
      player_two_name: 'Jordan Member',
      player_three_name: null,
      player_four_name: null,
      played_at: new Date().toISOString(),
      entered_by: 'another-member',
    };
    const user = userEvent.setup();
    renderClient({
      event: recentEvent,
      scores: [score],
      currentUserId: 'manager-1',
      isManager: true,
      canViewParticipants: true,
    });
    await user.click(screen.getByRole('button', { name: 'Edit score' }));
    await user.clear(screen.getByLabelText('Your team score'));
    await user.type(screen.getByLabelText('Your team score'), '6');
    await user.clear(screen.getByLabelText('Opponents score'));
    await user.type(screen.getByLabelText('Opponents score'), '4');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.writes).toContainEqual({
        table: 'event_scores',
        operation: 'update',
        values: { player_one_score: 6, player_two_score: 4 },
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Score updated.');
  });

  it('hides registration mutation controls for anonymous visitors and cancelled events', () => {
    const { rerender } = renderClient({ currentUserId: null });
    expect(screen.getByRole('link', { name: 'Sign in to register' })).toBeInTheDocument();
    rerender(
      <EventDetailClient
        event={{ ...event, status: 'cancelled' }}
        roster={[]}
        courts={[]}
        scores={[]}
        currentUserId="member-1"
        currentRegistrationId={null}
        currentStatus={null}
        locationQuery="Main courts"
        isManager={false}
        canViewParticipants={false}
        remainingSpots={12}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
    expect(screen.getByText('Event cancelled')).toBeInTheDocument();
  });
});
