import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogsConsole } from '@/components/admin/audit-logs-console';

const mocks = vi.hoisted(() => ({
  result: {
    data: [] as Record<string, unknown>[],
    count: 0,
    error: null as null | { message: string },
  },
  eventResult: { data: [] as Record<string, unknown>[], error: null as null | { message: string } },
  profileResult: {
    data: [] as Record<string, unknown>[],
    error: null as null | { message: string },
  },
  methods: {
    select: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn(),
    in: vi.fn(),
  },
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    from: (table: string) => {
      const query = {
        select: (...args: unknown[]) => {
          mocks.methods.select(...args);
          return query;
        },
        order: (...args: unknown[]) => {
          mocks.methods.order(...args);
          return query;
        },
        range: (...args: unknown[]) => {
          mocks.methods.range(...args);
          return Promise.resolve(mocks.result);
        },
        gte: (...args: unknown[]) => {
          mocks.methods.gte(...args);
          return query;
        },
        lt: (...args: unknown[]) => {
          mocks.methods.lt(...args);
          return query;
        },
        eq: (...args: unknown[]) => {
          mocks.methods.eq(...args);
          return query;
        },
        ilike: (...args: unknown[]) => {
          mocks.methods.ilike(...args);
          return query;
        },
        or: (...args: unknown[]) => {
          mocks.methods.or(...args);
          return query;
        },
        in: (...args: unknown[]) => {
          mocks.methods.in(...args);
          return Promise.resolve(table === 'events' ? mocks.eventResult : mocks.profileResult);
        },
      };
      return query;
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.result = { data: [], count: 0, error: null };
  mocks.eventResult = { data: [], error: null };
  mocks.profileResult = { data: [], error: null };
});

describe('AuditLogsConsole', () => {
  it('renders searchable audit filters and an empty state', async () => {
    render(<AuditLogsConsole />);
    expect(screen.getByLabelText(/search logs/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/no matching records/i)).toBeInTheDocument());
  });
  it('switches to application error filters', async () => {
    render(<AuditLogsConsole />);
    screen.getByRole('tab', { name: /application errors/i }).click();
    await waitFor(() => expect(screen.getByText(/all severities/i)).toBeInTheDocument());
  });
  it('renders grouped court movements and omits redundant record counts', async () => {
    mocks.result = {
      data: [
        {
          id: 17,
          occurred_at: '2026-06-01T12:00:00.000Z',
          actor_user_id: null,
          actor_label: 'user',
          action: 'event_court_assignments.save',
          outcome: 'success',
          target_table: 'event_court_assignments',
          target_record_id: null,
          event_id: 'event-1',
          route: null,
          source: 'rpc',
          summary: 'Court assignment saved (4 records)',
          changes: {
            player_changes: [
              {
                player_name: 'Alex Chen',
                player_id: 'player-1',
                registration_id: 'reg-1',
                session: 1,
                previous_court: 1,
                new_court: 2,
              },
              {
                player_name: 'Jordan Lee',
                player_id: 'player-2',
                registration_id: 'reg-2',
                session: 1,
                previous_court: 2,
                new_court: 1,
              },
            ],
          },
          metadata: { operation_id: 'operation-1' },
        },
      ],
      count: 1,
      error: null,
    };
    const user = userEvent.setup();
    const { container } = render(<AuditLogsConsole />);
    await waitFor(() => expect(screen.getByText('Court assignment saved')).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/\(4 records\)/i);
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Alex Chen — Session 1: Court 1 → Court 2')).toBeInTheDocument();
    expect(screen.getByText('Jordan Lee — Session 1: Court 2 → Court 1')).toBeInTheDocument();
    expect(screen.getByText(/operation_id/)).toBeInTheDocument();
  });

  it('applies audit filters and resolves actor/event names in change details', async () => {
    mocks.result = {
      data: [
        {
          id: 31,
          occurred_at: '2026-06-10T12:00:00.000Z',
          actor_user_id: 'actor-1',
          actor_label: 'user',
          action: 'profiles.update',
          outcome: 'success',
          target_table: 'profiles',
          target_record_id: 'profile-1',
          event_id: 'event-1',
          route: '/admin/members',
          source: 'web',
          summary: 'Updated membership contact',
          changes: {
            field_changes: {
              user_id: { old_value: 'old-user', new_value: 'actor-1' },
            },
          },
          metadata: {},
        },
      ],
      count: 1,
      error: null,
    };
    mocks.eventResult = { data: [{ id: 'event-1', title: 'Spring Open' }], error: null };
    mocks.profileResult = {
      data: [
        { id: 'actor-1', full_name: 'Owner Member', email: null },
        { id: 'old-user', full_name: null, email: 'prior@example.com' },
      ],
      error: null,
    };
    const user = userEvent.setup();
    render(<AuditLogsConsole />);
    await screen.findByText('Updated membership contact');
    mocks.methods.eq.mockClear();
    mocks.methods.gte.mockClear();
    mocks.methods.lt.mockClear();
    mocks.methods.ilike.mockClear();
    mocks.methods.or.mockClear();
    await user.type(screen.getByLabelText(/search logs/i), 'membership');
    await user.type(screen.getByLabelText('Action contains'), 'profile');
    await user.selectOptions(screen.getByLabelText('Outcome'), 'success');
    await user.selectOptions(screen.getByLabelText('Source'), 'web');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-06-30' } });

    await waitFor(() => expect(screen.getByText('Owner Member')).toBeInTheDocument());
    expect(screen.getByText('Spring Open')).toBeInTheDocument();
    expect(mocks.methods.ilike).toHaveBeenCalledWith('action', '%profile%');
    expect(mocks.methods.eq).toHaveBeenCalledWith('outcome', 'success');
    expect(mocks.methods.eq).toHaveBeenCalledWith('source', 'web');
    expect(mocks.methods.gte).toHaveBeenCalledWith(
      'occurred_at',
      expect.stringContaining('2026-06-01'),
    );
    expect(mocks.methods.lt).toHaveBeenCalledWith(
      'occurred_at',
      expect.stringContaining('2026-07-01'),
    );
    expect(mocks.methods.or).toHaveBeenCalledWith(
      expect.stringContaining('summary.ilike.%membership%'),
    );

    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'profiles: User Id changed from Player old-user to Player actor-1.',
    );
  });

  it('filters error logs, opens diagnostics, and clears filters', async () => {
    mocks.result = { data: [], count: 0, error: null };
    const user = userEvent.setup();
    render(<AuditLogsConsole />);
    await screen.findByText(/no matching records/i);
    mocks.result = {
      data: [
        {
          id: 22,
          occurred_at: '2026-06-01T12:00:00.000Z',
          actor_user_id: null,
          severity: 'critical',
          source: 'api',
          error_type: 'PaymentProviderError',
          message: 'Payment provider timed out',
          route: '/api/membership/family',
          operation: 'create_checkout',
          event_id: 'event-1',
          correlation_id: 'trace-22',
          details: { provider: 'gateway', retryable: true },
        },
      ],
      count: 1,
      error: null,
    };
    mocks.eventResult = { data: [{ id: 'event-1', title: 'Spring Open' }], error: null };
    await user.click(screen.getByRole('tab', { name: /application errors/i }));
    await user.selectOptions(screen.getByLabelText('Severity'), 'critical');
    await user.selectOptions(screen.getByLabelText('Source'), 'api');
    await user.type(screen.getByLabelText(/search logs/i), 'timeout');

    expect(await screen.findByText('PaymentProviderError')).toBeInTheDocument();
    expect(screen.getByText('Spring Open')).toBeInTheDocument();
    expect(mocks.methods.eq).toHaveBeenCalledWith('severity', 'critical');
    expect(mocks.methods.eq).toHaveBeenCalledWith('source', 'api');
    expect(mocks.methods.or).toHaveBeenCalledWith(
      'message.ilike.%timeout%,error_type.ilike.%timeout%,operation.ilike.%timeout%,route.ilike.%timeout%',
    );

    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('dialog', { name: 'Log entry details' })).toHaveTextContent(
      'Payment provider timed out',
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('trace-22');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Severity')).toHaveValue('');
    expect(screen.getByLabelText('Source')).toHaveValue('');
    expect(screen.getByLabelText(/search logs/i)).toHaveValue('');
  });

  it('reports query errors and paginates audit rows with a known total', async () => {
    mocks.result = { data: [], count: 0, error: { message: 'audit table unavailable' } };
    const { unmount } = render(<AuditLogsConsole />);
    expect(await screen.findByRole('alert')).toHaveTextContent('audit table unavailable');

    mocks.result = { data: [], count: 26, error: null };
    unmount();
    render(<AuditLogsConsole />);
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Page 2 of 2')).toBeInTheDocument());
    expect(mocks.methods.range).toHaveBeenLastCalledWith(25, 49);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument());
  });
});
