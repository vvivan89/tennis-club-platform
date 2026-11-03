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
vi.mock('@/lib/supabase-browser', () => {
  const client = {
    rpc: mocks.rpc,
    from: mocks.from,
    channel: () => ({ on: () => ({ subscribe: vi.fn() }) }),
    removeChannel: mocks.removeChannel,
  };
  return { createSupabaseBrowserClient: () => client };
});
vi.mock('@/components/event-weather', () => ({ EventWeather: () => null }));

import { EventDetailClient } from '@/components/event-detail-client';

function queryFor(table: string) {
  let operation = 'select';
  let values: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: () => query,
    neq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: mocks.rows[table]?.[0] ?? null, error: null }),
    update: (payload: Record<string, unknown>) => {
      operation = 'update';
      values = payload;
      mocks.writes.push({ table, operation, values });
      return query;
    },
    delete: () => {
      operation = 'delete';
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
      currentPaymentStatus={overrides.currentPaymentStatus ?? null}
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
    expect(mocks.rpc).toHaveBeenCalledWith(
      'register_for_event',
      expect.objectContaining({
        p_event_id: 'event-1',
        p_idempotency_key: expect.any(String),
      }),
    );
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  });

  it('requires confirmation before withdrawing and refreshes after the database result', async () => {
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
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledOnce());
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
    expect(mocks.rpc).toHaveBeenCalledWith(
      'register_for_event',
      expect.objectContaining({ p_event_id: 'event-1' }),
    );
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledOnce());
  });

  it('submits Interac payment and displays the returned transfer instructions', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        amountMinor: 2500,
        recipientEmail: 'payments@example.test',
        paymentId: 'interac-payment',
        instructions: 'Include your member name.',
        message: 'Transfer request created.',
      }),
    });
    const user = userEvent.setup();
    renderClient({
      currentRegistrationId: 'registration-1',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
      interacEnabled: true,
      event: { ...event, price_cents: 2500 },
    });

    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('menuitem', { name: /By Interac/ }));
    expect(await screen.findByText('Transfer request created.')).toBeInTheDocument();
    expect(screen.getByText('payments@example.test')).toBeInTheDocument();
    expect(screen.getByText('Include your member name.')).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/payments/checkout',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"provider":"interac"'),
      }),
    );
  });

  it('shows Interac instructions when the payment service omits optional copy', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ amountMinor: 2500, paymentId: 'interac-no-copy' }),
    });
    const user = userEvent.setup();
    renderClient({
      currentRegistrationId: 'registration-1',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
      interacEnabled: true,
      event: { ...event, price_cents: 2500 },
    });

    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('menuitem', { name: /By Interac/ }));

    expect(await screen.findByText(/Interac payment request submitted/)).toBeInTheDocument();
    expect(screen.queryByText('Transfer request created.')).not.toBeInTheDocument();
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  });

  it('restores saved Interac instructions for an existing pending request', async () => {
    mocks.rows.payments = [{ id: 'saved-interac', amount_minor: 2500, status: 'pending' }];
    mocks.rows.payment_method_settings = [
      {
        interac_recipient_email: 'club-payments@example.test',
        interac_instructions: 'Use the event title in the transfer note.',
      },
    ];
    renderClient({
      currentRegistrationId: 'registration-1',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
      interacEnabled: true,
      event: { ...event, price_cents: 2500 },
    });

    expect(await screen.findByText(/Interac payment requested:/)).toHaveTextContent(
      'Interac payment requested: $25.00. Awaiting club confirmation.',
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('menuitem', { name: /View Interac instructions/ }));
    expect(screen.getByText('club-payments@example.test')).toBeInTheDocument();
    expect(screen.getByText('Use the event title in the transfer note.')).toBeInTheDocument();
  });

  it('reconciles a paid registration through the payment-status endpoint', async () => {
    mocks.rows.payments = [{ id: 'card-payment', status: 'pending', amount_minor: 2500 }];
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        payment: { status: 'succeeded' },
        fulfilled: true,
      }),
    });
    const user = userEvent.setup();
    renderClient({
      currentRegistrationId: 'registration-1',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
      event: { ...event, price_cents: 2500 },
    });

    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledOnce());
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/payments/status?registration_id=registration-1',
      { cache: 'no-store' },
    );
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'processing',
      false,
      'Payment is still pending. If you just completed checkout, check again shortly.',
    ],
    [
      'succeeded',
      false,
      'Payment confirmed. Your registration is being finalized. Check again shortly.',
    ],
    [
      'pending',
      false,
      'Payment is still pending. If you just completed checkout, check again shortly.',
    ],
  ])(
    'keeps the registration reserved while Stripe reports %s without fulfillment',
    async (status, fulfilled, message) => {
      mocks.rows.payments = [{ id: 'card-payment', status: 'pending', amount_minor: 2500 }];
      mocks.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ payment: { status }, fulfilled }),
      });
      const user = userEvent.setup();
      renderClient({
        currentRegistrationId: 'registration-1',
        currentStatus: 'confirmed',
        currentPaymentStatus: 'pending',
        event: { ...event, price_cents: 2500 },
      });

      await user.click(screen.getByRole('button', { name: 'Pay' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(mocks.routerRefresh).toHaveBeenCalled();
    },
  );

  it('shows card status only after a pending attempt and returns canceled payments to the By card option', async () => {
    mocks.rows.payments = [{ id: 'card-payment', status: 'pending', amount_minor: 2500 }];
    mocks.rows.registrations = [
      {
        id: 'registration-1',
        status: 'confirmed',
        payment_status: 'failed',
        created_at: '2026-01-01',
      },
    ];
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ payment: { status: 'canceled' }, fulfilled: false }),
    });
    const user = userEvent.setup();
    renderClient({
      currentRegistrationId: 'registration-1',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
      event: { ...event, price_cents: 2500 },
    });
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/payments/status?registration_id=registration-1',
        { cache: 'no-store' },
      ),
    );
    expect(
      await screen.findByText(
        'The previous payment was not completed. You can try paying the fee again.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pay' }));
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/payments/checkout',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"provider":"stripe"'),
      }),
    );
  });

  it('restarts checkout when no prior payment exists and reports payment-status errors', async () => {
    mocks.rows.payments = [{ id: 'card-payment', status: 'pending', amount_minor: 2500 }];
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payment: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const user = userEvent.setup();
    const { unmount } = renderClient({
      currentRegistrationId: 'registration-1',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
      event: { ...event, price_cents: 2500 },
    });
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start checkout.');
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/payments/checkout',
      expect.objectContaining({
        body: expect.stringContaining('"businessRecordId":"registration-1"'),
      }),
    );
    unmount();

    mocks.fetch.mockReset().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Payment status unavailable.' }),
    });
    mocks.rows.payments = [{ id: 'card-payment', status: 'pending', amount_minor: 2500 }];
    renderClient({
      currentRegistrationId: 'registration-1',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
      event: { ...event, price_cents: 2500 },
    });
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment status unavailable.');
  });

  it('starts checkout after a paid event registration and preserves the reserved entry on failure', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ registration_id: 'registration-new', registration_state: 'confirmed' }],
      error: null,
    });
    mocks.rows.registrations = [{ payment_status: 'pending' }];
    mocks.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Checkout unavailable.' }),
    });
    const user = userEvent.setup();
    renderClient({ event: { ...event, price_cents: 2500 } });

    await user.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/payments/checkout',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"businessRecordId":"registration-new"'),
        }),
      ),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'register_for_event',
      expect.objectContaining({ p_event_id: 'event-1' }),
    );
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
  });

  it('uses event ID in checkout return paths and reports non-Error checkout failures', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ registration_id: 'registration-new', registration_state: 'confirmed' }],
      error: null,
    });
    mocks.fetch.mockRejectedValue('network unavailable');
    const user = userEvent.setup();
    renderClient({ event: { ...event, slug: null, price_cents: 2500 } });

    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Registration is reserved, but payment could not be started. Please try again.',
    );
    expect(
      screen.getByText('Your registration is reserved, but payment is still required.'),
    ).toBeInTheDocument();
  });

  it('keeps an unpaid registration when payment cancellation fails before withdrawal', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Checkout could not be canceled safely.' }),
    });
    const user = userEvent.setup();
    renderClient({
      event: { ...event, price_cents: 2500 },
      currentRegistrationId: 'registration-pending',
      currentStatus: 'confirmed',
      currentPaymentStatus: 'pending',
    });

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/payments/cancel',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ registrationId: 'registration-pending' }),
        }),
      ),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith('withdraw_from_event', expect.anything());
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
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
    await user.type(screen.getByLabelText('Opponents’ score'), '4');
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
    await user.type(screen.getByLabelText('Opponents’ score'), '5');
    fireEvent.submit(screen.getByText('Add a score').closest('form') as HTMLFormElement);
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

  it('lets a manager choose either team on a doubles court and saves the opposing pair', async () => {
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
      court_number: 2,
      segment_order: 3,
    }));
    const user = userEvent.setup();
    renderClient({
      event: startedEvent,
      roster,
      courts,
      isManager: true,
      canViewParticipants: true,
    });

    await user.selectOptions(screen.getByLabelText('Court / sub-session'), '2:3');
    await user.selectOptions(screen.getByLabelText('Team player'), 'reg-3');
    await user.selectOptions(screen.getByLabelText('Partner'), 'reg-4');
    expect(screen.getByText('Opponents: Alex / Jordan')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Team score'), '6');
    await user.type(screen.getByLabelText('Opposing team score'), '2');
    fireEvent.submit(screen.getByText('Add a score').closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(mocks.writes).toContainEqual({
        table: 'event_scores',
        operation: 'insert',
        values: {
          event_id: 'event-1',
          player_one_registration_id: 'reg-3',
          player_two_registration_id: 'reg-4',
          player_three_registration_id: 'reg-1',
          player_four_registration_id: 'reg-2',
          player_one_score: 6,
          player_two_score: 2,
          entered_by: 'member-1',
        },
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
    await user.type(screen.getByLabelText('Opponents’ score'), '2');
    fireEvent.submit(screen.getByText('Add a score').closest('form') as HTMLFormElement);
    expect(mocks.writes).toHaveLength(0);
  });

  it('shows manager contact details and waitlist entries in court view', async () => {
    const user = userEvent.setup();
    renderClient({
      isManager: true,
      canViewParticipants: true,
      roster: [
        {
          registration_id: 'court-player-1',
          user_id: 'member-1',
          status: 'confirmed',
          queue_position: null,
          full_name: 'Alex Court',
          avatar_url: null,
          tennis_skill_level: 3.5,
          email: 'alex@example.test',
          phone: null,
        },
        {
          registration_id: 'court-player-2',
          user_id: 'member-2',
          status: 'confirmed',
          queue_position: null,
          full_name: 'Jordan Court',
          avatar_url: null,
          tennis_skill_level: null,
          email: null,
          phone: '604-555-0123',
        },
        {
          registration_id: 'waitlisted-player',
          user_id: 'member-3',
          status: 'waitlisted',
          queue_position: 2,
          full_name: 'Waitlisted Player',
          avatar_url: null,
          tennis_skill_level: null,
          email: 'waiting@example.test',
          phone: '604-555-0199',
        },
      ],
      courts: [
        { registration_id: 'court-player-1', court_number: 1, segment_order: 1 },
        { registration_id: 'court-player-2', court_number: 1, segment_order: 1 },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Court view' }));
    expect(screen.getByRole('heading', { name: 'Time slot 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Court 1' })).toBeInTheDocument();
    expect(screen.getByText('Alex Court')).toBeInTheDocument();
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alex@example.test' })).toHaveAttribute(
      'href',
      'mailto:alex@example.test',
    );
    expect(screen.getByRole('link', { name: '604-555-0123' })).toHaveAttribute(
      'href',
      'tel:604-555-0123',
    );
    expect(screen.getByText('Waitlisted Player')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'waiting@example.test' })).toHaveAttribute(
      'href',
      'mailto:waiting@example.test',
    );
    expect(screen.getByText('(position 2)')).toBeInTheDocument();
  });

  it('logs and displays registration and withdrawal RPC failure details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const user = userEvent.setup();
    const { rerender } = renderClient();
    await user.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[Event detail] Database registration failed', {
        message: 'private database detail',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('private database detail');

    rerender(
      <EventDetailClient
        event={event}
        roster={[]}
        courts={[]}
        scores={[]}
        currentUserId="member-1"
        currentRegistrationId="registration-1"
        currentStatus="confirmed"
        currentPaymentStatus={null}
        locationQuery="Main courts"
        isManager={false}
        canViewParticipants={false}
        remainingSpots={12}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[Event detail] Database withdrawal failed', {
        message: 'private database detail',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not update registration.');
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
      isAdmin: true,
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
    expect(mocks.routerRefresh).toHaveBeenCalled();
  });

  it('limits score edit and delete actions to admins and the score author', async () => {
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
      entered_by: 'score-author',
    };
    const user = userEvent.setup();
    const { rerender } = renderClient({
      scores: [score],
      currentUserId: 'organizer-1',
      isManager: true,
      isAdmin: false,
    });
    expect(screen.queryByRole('button', { name: 'Edit score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete score' })).not.toBeInTheDocument();

    rerender(
      <EventDetailClient
        event={event}
        roster={[]}
        courts={[]}
        scores={[score]}
        currentUserId="score-author"
        currentRegistrationId={null}
        currentStatus={null}
        currentPaymentStatus={null}
        locationQuery="Main courts"
        isManager={false}
        canViewParticipants
        remainingSpots={12}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete score' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'This score will be permanently removed.',
    );
    expect(mocks.writes).toHaveLength(0);
    await user.click(
      screen.getByRole('alertdialog').querySelector('button:last-child') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(mocks.writes).toContainEqual(
        expect.objectContaining({ table: 'event_scores', operation: 'delete' }),
      ),
    );
    expect(mocks.routerRefresh).toHaveBeenCalled();
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
        currentPaymentStatus={null}
        locationQuery="Main courts"
        isManager={false}
        canViewParticipants={false}
        remainingSpots={12}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
    expect(screen.getByText('Event cancelled')).toBeInTheDocument();
  });

  it('explains a future registration window and the member eligibility requirement', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { rerender } = renderClient({
      event: {
        ...event,
        event_type: 'tournament',
        ends_at: null,
        registration_opens_at: future,
        members_only: true,
      },
    });
    expect(screen.getByText('Tournament')).toBeInTheDocument();
    expect(screen.getByText(/Until To be announced/)).toBeInTheDocument();
    expect(screen.getByText('Cutoff Not set')).toBeInTheDocument();
    expect(screen.getByText('Active, paid membership required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registration closed' })).toBeDisabled();
    expect(screen.getByText(/Registration is not currently open/)).toBeInTheDocument();

    rerender(
      <EventDetailClient
        event={{ ...event, status: 'published', registration_opens_at: '2020-01-01T00:00:00Z' }}
        roster={[]}
        courts={[]}
        scores={[]}
        currentUserId="member-1"
        currentRegistrationId={null}
        currentStatus={null}
        currentPaymentStatus={null}
        locationQuery="Main courts"
        isManager={false}
        canViewParticipants={false}
        remainingSpots={1}
      />,
    );
    expect(screen.getByText('1 spot remaining')).toBeInTheDocument();

    rerender(
      <EventDetailClient
        event={{
          ...event,
          registration_opens_at: '2020-01-01T00:00:00Z',
          registration_closes_at: new Date(Date.now() - 60_000).toISOString(),
        }}
        roster={[]}
        courts={[]}
        scores={[]}
        currentUserId="member-1"
        currentRegistrationId={null}
        currentStatus={null}
        currentPaymentStatus={null}
        locationQuery=""
        isManager={false}
        canViewParticipants={false}
        remainingSpots={12}
      />,
    );
    expect(screen.getByRole('button', { name: 'Registration closed' })).toBeDisabled();
    expect(screen.getByText(/Registration is not currently open/)).toBeInTheDocument();
  });
});
