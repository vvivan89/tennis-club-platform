import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  queryRows: {} as Record<string, unknown[][]>,
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
        or: () => query,
        limit: () => query,
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          const result = mocks.queryRows[table]?.shift() ?? [];
          return Promise.resolve({ data: result, error: null }).then(resolve, reject);
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
  vi.clearAllMocks();
});

describe('EventEditManagement court assignments', () => {
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
