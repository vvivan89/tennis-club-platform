import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  routerRefresh: vi.fn(),
  onClose: vi.fn(),
  calls: [] as Array<{ table: string; operation: string; values?: unknown }>,
  errors: {} as Record<string, { message: string } | null>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query = {
        upsert: (values: unknown) => {
          mocks.calls.push({ table, operation: 'upsert', values });
          return Promise.resolve({ error: mocks.errors[table] ?? null });
        },
        insert: (values: unknown) => {
          mocks.calls.push({ table, operation: 'insert', values });
          return Promise.resolve({ error: mocks.errors[table] ?? null });
        },
        update: (values: unknown) => {
          mocks.calls.push({ table, operation: 'update', values });
          return query;
        },
        delete: () => {
          mocks.calls.push({ table, operation: 'delete' });
          return query;
        },
        eq: () => query,
        then: (
          resolve: (value: { error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ error: mocks.errors[table] ?? null }).then(resolve, reject),
      };
      return query;
    },
  }),
}));

import { MemberEditModal } from '@/components/member-edit-modal';

const member = {
  id: 'member-1',
  full_name: 'Member One',
  email: 'member@example.com',
  role: 'member',
  admin_comment: 'Existing note',
  suspensions: [],
};

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.routerRefresh.mockReset();
  mocks.onClose.mockReset();
  mocks.calls = [];
  mocks.errors = {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MemberEditModal', () => {
  it('saves trimmed admin notes, a suspension, and a permitted role change', async () => {
    const user = userEvent.setup();
    render(<MemberEditModal member={member} onClose={mocks.onClose} />);
    await user.clear(screen.getByLabelText('Administrator comment'));
    await user.type(screen.getByLabelText('Administrator comment'), '  follow up  ');
    await user.selectOptions(screen.getByLabelText('Role'), 'organizer');
    await user.type(screen.getByLabelText('Date from'), '2026-11-01');
    await user.type(screen.getByLabelText('Date to'), '2026-11-15');
    await user.type(screen.getByLabelText('Reason'), '  Conduct review  ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledOnce());
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'member_admin_notes',
        operation: 'upsert',
        values: expect.objectContaining({
          user_id: 'member-1',
          comment: 'follow up',
          updated_by: 'admin-1',
        }),
      }),
    );
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'member_suspensions',
        operation: 'insert',
        values: expect.objectContaining({
          user_id: 'member-1',
          reason: 'Conduct review',
          created_by: 'admin-1',
        }),
      }),
    );
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'profiles',
        operation: 'update',
        values: { role: 'organizer' },
      }),
    );
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  });

  it('does not create an incomplete or reversed suspension', async () => {
    const user = userEvent.setup();
    render(<MemberEditModal member={member} onClose={mocks.onClose} />);
    await user.type(screen.getByLabelText('Date from'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Add suspension' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save member details');
    expect(mocks.calls.some((call) => call.table === 'member_suspensions')).toBe(false);

    await user.type(screen.getByLabelText('Date to'), '2026-11-01');
    await user.type(screen.getByLabelText('Reason'), 'Reason');
    await user.click(screen.getByRole('button', { name: 'Add suspension' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save member details');
    expect(mocks.calls.some((call) => call.table === 'member_suspensions')).toBe(false);
  });

  it('prevents self-role edits, closes on Escape, and does not persist another role', async () => {
    mocks.user = { id: member.id };
    const user = userEvent.setup();
    render(<MemberEditModal member={member} onClose={mocks.onClose} />);
    await waitFor(() => expect(screen.getByLabelText('Role')).toBeDisabled());
    expect(screen.getByText('You cannot change your own role.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it('edits an existing suspension and labels active, ended, and scheduled history', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const user = userEvent.setup();
    render(
      <MemberEditModal
        member={{
          ...member,
          suspensions: [
            {
              id: 'active-1',
              starts_on: today,
              ends_on: tomorrow,
              reason: 'Current review',
              created_at: today,
            },
            {
              id: 'ended-1',
              starts_on: '2020-01-01',
              ends_on: yesterday,
              reason: 'Old review',
              created_at: '2020-01-01',
            },
            {
              id: 'scheduled-1',
              starts_on: tomorrow,
              ends_on: '2999-12-31',
              reason: 'Future review',
              created_at: today,
            },
          ],
        }}
        onClose={mocks.onClose}
      />,
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    const activeCard = screen
      .getByText('Current review')
      .closest('.rounded-lg.border') as HTMLElement;
    await user.click(within(activeCard).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit suspension' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Reason'));
    await user.type(screen.getByLabelText('Reason'), '  Updated conduct review  ');
    await user.click(screen.getByRole('button', { name: 'Save suspension' }));

    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledOnce());
    expect(mocks.calls).toContainEqual(
      expect.objectContaining({
        table: 'member_suspensions',
        operation: 'update',
        values: expect.objectContaining({
          starts_on: today,
          ends_on: tomorrow,
          reason: 'Updated conduct review',
          cancelled_at: null,
          cancelled_by: null,
        }),
      }),
    );
  });

  it('confirms suspension removal and retains the history when deletion fails', async () => {
    mocks.errors.member_suspensions = { message: 'delete denied' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <MemberEditModal
        member={{
          ...member,
          suspensions: [
            {
              id: 'suspension-1',
              starts_on: '2026-10-01',
              ends_on: '2026-10-02',
              reason: 'Review',
              created_at: '2026-10-01',
            },
          ],
        }}
        onClose={mocks.onClose}
      />,
    );
    const suspension = screen.getByText('Review').closest('.rounded-lg.border') as HTMLElement;
    await user.click(within(suspension).getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Remove suspension history?');
    await user.click(screen.getByRole('button', { name: 'Remove suspension' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove suspension');
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(mocks.calls).toContainEqual({ table: 'member_suspensions', operation: 'delete' });
    expect(mocks.onClose).not.toHaveBeenCalled();
  });
});
