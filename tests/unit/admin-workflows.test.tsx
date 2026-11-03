import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { AdminApplications } from '@/components/admin-applications';
import { InviteMemberForm } from '@/components/invite-member-form';
import { MembershipTypesAdmin } from '@/components/membership-types-admin';
import { MembersTable, type MemberRow } from '@/components/admin-members-table';

const application = {
  id: 'application-1',
  full_name: 'New Player',
  email: 'new@example.com',
  phone: '604.555.0100',
  tennis_skill_level: '3.5',
  application_comment: 'Interested in doubles',
  created_at: '2026-01-01T00:00:00Z',
};
const member = (overrides: Partial<MemberRow> = {}): MemberRow => ({
  id: 'member-1',
  full_name: 'Alex Member',
  email: 'alex@example.com',
  phone: '604.555.0100',
  tennis_skill_level: '3.5',
  role: 'member',
  created_at: '2020-01-01',
  payment_status: 'paid',
  membership_type: 'single',
  family_members: [],
  last_played: null,
  admin_comment: '',
  suspensions: [],
  ...overrides,
});

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('administrator workflow components', () => {
  it('approves applications and reports that email delivery is separate from approval', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true, emailSent: false }), { status: 200 }),
    );
    const user = userEvent.setup();
    render(<AdminApplications applications={[application]} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Application approved.');
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/admin/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'application-1', action: 'approve' }),
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('leaves failed applications visible and renders an error', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'denied' }), { status: 403 }),
    );
    const user = userEvent.setup();
    render(<AdminApplications applications={[application]} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update application');
    expect(screen.getByText('New Player')).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('renders empty and incomplete applications, and confirms dismissal', async () => {
    const { rerender } = render(<AdminApplications applications={[]} />);
    expect(screen.getByText('There are no pending applications.')).toBeInTheDocument();
    rerender(
      <AdminApplications
        applications={[
          { ...application, full_name: '', tennis_skill_level: null, application_comment: '' },
          { ...application, id: 'application-2', full_name: 'Second Player' },
        ]}
      />,
    );
    expect(screen.getByText('Name not provided')).toBeInTheDocument();
    expect(screen.getByText('No comment provided.')).toBeInTheDocument();

    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true, emailSent: true }), { status: 200 }),
    );
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    expect(await screen.findByRole('status')).toHaveTextContent('Application dismissed.');
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/admin/applications',
      expect.objectContaining({
        body: JSON.stringify({ userId: 'application-1', action: 'dismiss' }),
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('opens the invitation form, submits profile fields, and handles API failure', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const user = userEvent.setup();
    render(<InviteMemberForm />);
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(screen.getByLabelText(/Full name/), 'Taylor Member');
    await user.type(screen.getByLabelText(/Email/), 'taylor@example.com');
    await user.type(screen.getByLabelText(/Phone/), '6045550100');
    await user.selectOptions(screen.getByLabelText(/Tennis skill rating/), '4.0');
    await user.click(screen.getByRole('button', { name: 'Send invitation email' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to taylor@example.com',
    );
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({
      full_name: 'Taylor Member',
      email: 'taylor@example.com',
      tennis_skill_level: '4.0',
    });

    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }),
    );
    await user.click(screen.getByRole('button', { name: 'Hide form' }));
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(screen.getByLabelText(/Full name/), 'Another Member');
    await user.type(screen.getByLabelText(/Email/), 'another@example.com');
    await user.type(screen.getByLabelText(/Phone/), '6045550101');
    await user.click(screen.getByRole('button', { name: 'Send invitation email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('bad request');
  });

  it('serializes membership limits and calendar month boundaries when saving settings', async () => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const user = userEvent.setup();
    render(
      <MembershipTypesAdmin
        initial={{
          single_price_cad: 150,
          family_price_cad: 250,
          family_max_adults: 2,
          family_max_children: 4,
          season_start_month: 4,
          season_end_month: 9,
        }}
      />,
    );
    await user.clear(screen.getByLabelText('Maximum adults'));
    await user.type(screen.getByLabelText('Maximum adults'), '3');
    await user.selectOptions(screen.getByLabelText('Season end month'), '2');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ family_max_adults: 3, season_end_month: 2 });
    expect(body.season_end_date).toMatch(/-02-28$/);
    expect(await screen.findByRole('status')).toHaveTextContent('Membership settings saved');
  });

  it('filters members by role, paid state, and search while showing active suspensions', async () => {
    const user = userEvent.setup();
    render(
      <MembersTable
        initialMembers={[
          member({
            id: 'm1',
            full_name: 'Alex Member',
            role: 'member',
            payment_status: 'paid',
            suspensions: [
              {
                id: 's1',
                starts_on: '2020-01-01',
                ends_on: '2999-12-31',
                reason: 'Review',
                created_at: '2020-01-01',
              },
            ],
          }),
          member({
            id: 'm2',
            full_name: 'Jordan Organizer',
            email: 'jordan@example.com',
            phone: '604.555.0200',
            role: 'organizer',
            payment_status: 'unpaid',
          }),
        ]}
      />,
    );
    expect(screen.getByText(/Active:/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Role'), 'organizer');
    expect(screen.queryByText('Alex Member')).not.toBeInTheDocument();
    expect(screen.getByText('Jordan Organizer')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Paid status'), 'paid');
    expect(screen.getByText('0 of 2 members')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Role'), 'all');
    await user.selectOptions(screen.getByLabelText('Paid status'), 'all');
    const search = screen.getByLabelText('Search members');
    fireEvent.change(search, { target: { value: 'alex' } });
    expect(screen.getByLabelText('Search members')).toHaveValue('alex');
    await waitFor(() => expect(screen.getByText('1 of 2 members')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Jordan Organizer')).not.toBeInTheDocument());
    expect(screen.getByText('Alex Member')).toBeInTheDocument();
  });

  it('sorts member columns in both directions and filters membership types', async () => {
    const user = userEvent.setup();
    render(
      <MembersTable
        initialMembers={[
          member({
            id: 'm1',
            full_name: 'Alex Member',
            last_played: null,
            payment_status: 'paid',
            membership_type: 'single',
            suspensions: [],
          }),
          member({
            id: 'm2',
            full_name: 'Jordan Organizer',
            email: 'jordan@example.com',
            phone: '',
            role: 'organizer',
            created_at: '2021-01-01',
            last_played: '2025-01-01',
            payment_status: 'unpaid',
            membership_type: 'family',
            family_members: ['Taylor Member'],
            suspensions: [
              {
                id: 'future',
                starts_on: '2999-01-01',
                ends_on: '2999-01-07',
                reason: 'Scheduled',
                created_at: '2026-01-01',
              },
            ],
          }),
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Membership type'), 'family');
    expect(screen.getByText('1 of 2 members')).toBeInTheDocument();
    expect(screen.getByText('Scheduled: 2999-01-01 – 2999-01-07')).toBeInTheDocument();
    expect(
      screen.getAllByText('Family').find((element) => element.tagName === 'SPAN'),
    ).toHaveAttribute('title', 'Family members: Taylor Member');
    expect(screen.getByText('No phone')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Membership type'), 'all');

    for (const label of [
      'Name',
      'Contacts',
      'Skill rating',
      'Role',
      'Type',
      'Last played',
      'Suspension',
      'Joined',
    ]) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
      await user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
    }
    expect(screen.getByText('2 of 2 members')).toBeInTheDocument();
  });

  it('shows an empty member state and does not flag unassigned or paid membership as unpaid', () => {
    const { rerender } = render(<MembersTable initialMembers={[]} />);
    expect(screen.getByText('No matching members found.')).toBeInTheDocument();
    rerender(
      <MembersTable
        initialMembers={[
          member({ membership_type: 'none', payment_status: 'unpaid' }),
          member({ id: 'member-2', membership_type: 'single', payment_status: 'paid' }),
        ]}
      />,
    );
    expect(screen.queryByLabelText('Membership is unpaid')).not.toBeInTheDocument();
  });
});
