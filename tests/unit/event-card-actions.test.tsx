import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1' } as null | { id: string },
  profile: { application_status: 'approved' },
  event: {
    status: 'published',
    starts_at: '2999-06-01T12:00:00Z',
    registration_opens_at: '2020-01-01T00:00:00Z',
    registration_closes_at: null,
  } as Record<string, any>,
  registration: null as null | {
    id: string;
    status: 'confirmed' | 'waitlisted';
    created_at: string;
    payment_status?: string;
  },
  tournamentEntries: [] as Array<{
    category: string;
    payment_status: string;
    amount_cents: number;
  }>,
  suspension: null as null | { starts_on: string; ends_on: string; reason: string },
  rpc: vi.fn(),
  routerRefresh: vi.fn(),
  routerPush: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh, push: mocks.routerPush }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: (name: string, ...args: unknown[]) =>
      name === 'event_tournament_my_entries'
        ? Promise.resolve({ data: mocks.tournamentEntries, error: null })
        : mocks.rpc(name, ...args),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        is: () => query,
        lte: () => query,
        gte: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data:
            table === 'events'
              ? mocks.event
              : table === 'profiles'
                ? mocks.profile
                : mocks.registration,
          error: null,
        }),
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({
            data: table === 'member_suspensions' && mocks.suspension ? [mocks.suspension] : [],
            error: null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));

import { EventCardActions } from '@/components/event-card-actions';

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.profile = { application_status: 'approved' };
  mocks.event = {
    status: 'published',
    starts_at: '2999-06-01T12:00:00Z',
    registration_opens_at: '2020-01-01T00:00:00Z',
    registration_closes_at: null,
  };
  mocks.registration = null;
  mocks.tournamentEntries = [];
  mocks.suspension = null;
  mocks.rpc.mockReset().mockResolvedValue({
    data: [{ registration_id: 'reg-new', registration_state: 'confirmed' }],
    error: null,
  });
  mocks.routerRefresh.mockReset();
  mocks.routerPush.mockReset();
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ failed: 0 }) });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('EventCardActions', () => {
  it('does not expose registration controls for anonymous or unapproved users', async () => {
    mocks.user = null;
    const { rerender } = render(<EventCardActions eventId="event-1" />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument(),
    );
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'pending' };
    rerender(<EventCardActions eventId="event-1" />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument(),
    );
  });

  it('registers through the RPC, retains the returned state, refreshes, and dispatches notifications', async () => {
    const user = userEvent.setup();
    render(<EventCardActions eventId="event-1" />);
    await user.click(await screen.findByRole('button', { name: 'Register' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Registered'));
    expect(mocks.rpc).toHaveBeenCalledWith(
      'register_for_event',
      expect.objectContaining({ p_event_id: 'event-1', p_idempotency_key: expect.any(String) }),
    );
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/notifications/dispatch',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports a registration failure without changing state or refreshing', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('registration blocked') });
    const user = userEvent.setup();
    render(<EventCardActions eventId="event-1" />);
    await user.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByText('registration blocked')).toBeInTheDocument();
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
  });

  it('requires withdrawal confirmation and withdraws only after explicit confirmation', async () => {
    mocks.registration = { id: 'reg-1', status: 'waitlisted', created_at: '2025-01-01' };
    const user = userEvent.setup();
    render(<EventCardActions eventId="event-1" />);
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep my place' }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'withdraw_from_event',
        expect.objectContaining({
          p_registration_id: 'reg-1',
          p_idempotency_key: expect.any(String),
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('disables registration for a suspended member and displays suspension context on demand', async () => {
    mocks.suspension = {
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
      reason: 'Membership review',
    };
    const user = userEvent.setup();
    render(<EventCardActions eventId="event-1" />);
    const register = await screen.findByRole('button', { name: 'Register' });
    expect(register).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Suspension information' }));
    expect(screen.getByText('Membership review')).toBeInTheDocument();
  });

  it('sends tournaments with registration choices to the registration section and shows category payment state', async () => {
    mocks.event = {
      ...mocks.event,
      slug: 'summer-open',
      event_type: 'tournament',
      tournament_format: 'doubles',
      tournament_config: { categories: ['men', 'mixed'], registration_mode: 'both' },
      social_doubles_ladder_id: null,
    };
    const user = userEvent.setup();
    const firstRender = render(<EventCardActions eventId="event-tournament" />);
    await user.click(await screen.findByRole('button', { name: 'Register' }));
    expect(mocks.routerPush).toHaveBeenCalledWith('/events/summer-open#registration');
    expect(mocks.rpc).not.toHaveBeenCalled();

    firstRender.unmount();
    mocks.tournamentEntries = [
      { category: 'men', payment_status: 'pending', amount_cents: 2500 },
      { category: 'mixed', payment_status: 'paid', amount_cents: 0 },
    ];
    render(<EventCardActions eventId="event-tournament" />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Pending payment · registered for 2 categories',
    );
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View registration' }));
    expect(mocks.routerPush).toHaveBeenLastCalledWith('/events/summer-open#registration');
  });

  it('labels one pending tournament entry and hides closed events without a registration', async () => {
    mocks.event = {
      ...mocks.event,
      event_type: 'tournament',
      tournament_format: 'team',
      tournament_config: { categories: ['team'] },
      social_doubles_ladder_id: null,
    };
    mocks.tournamentEntries = [{ category: 'team', payment_status: 'pending', amount_cents: 5000 }];
    const firstRender = render(<EventCardActions eventId="event-tournament" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Pending payment');

    firstRender.unmount();
    mocks.tournamentEntries = [];
    mocks.event = { ...mocks.event, status: 'cancelled' };
    render(<EventCardActions eventId="event-tournament" />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument(),
    );
  });

  it('shows ordinary pending and waitlisted states and prevents withdrawal after cutoff', async () => {
    mocks.event = { ...mocks.event, price_cents: 2500 };
    mocks.registration = {
      id: 'registration-pending',
      status: 'confirmed',
      payment_status: 'pending',
      created_at: '2026-01-01',
    };
    const pendingView = render(<EventCardActions eventId="event-social" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Pending payment');
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    pendingView.unmount();

    mocks.registration = {
      id: 'registration-waitlisted',
      status: 'waitlisted',
      payment_status: 'paid',
      created_at: '2026-01-01',
    };
    const waitlistedView = render(<EventCardActions eventId="event-social" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Waitlisted');
    waitlistedView.unmount();

    mocks.registration = {
      id: 'registration-closed',
      status: 'confirmed',
      payment_status: 'paid',
      created_at: '2026-01-01',
    };
    mocks.event = { ...mocks.event, registration_closes_at: '2000-01-01T00:00:00Z' };
    render(<EventCardActions eventId="event-social" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Registered');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('opens the event for a doubles registration choice even with one category and falls back to the event id', async () => {
    mocks.event = {
      ...mocks.event,
      event_type: 'tournament',
      tournament_format: 'doubles',
      tournament_config: { categories: ['mixed'], registration_mode: 'both' },
      social_doubles_ladder_id: null,
      slug: null,
    };
    const user = userEvent.setup();
    render(<EventCardActions eventId="tournament-id" />);
    await user.click(await screen.findByRole('button', { name: 'Register' }));
    expect(mocks.routerPush).toHaveBeenCalledWith('/events/tournament-id#registration');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps the registration visible when a withdrawal RPC fails', async () => {
    mocks.registration = {
      id: 'reg-withdraw-error',
      status: 'confirmed',
      created_at: '2026-01-01',
    };
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('withdrawal unavailable') });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<EventCardActions eventId="event-1" />);
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Registered');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not complete registration');
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('refreshes after a registration RPC that returns no registration row', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const user = userEvent.setup();
    render(<EventCardActions eventId="event-1" />);
    await user.click(await screen.findByRole('button', { name: 'Register' }));
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
