import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  rows: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        is: () => query,
        or: () => query,
        order: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: Object.prototype.hasOwnProperty.call(mocks.rows, table) ? mocks.rows[table] : [],
            error: mocks.errors[table] ?? null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/admin-section-tabs', () => ({
  AdminSectionTabs: () => <div>Membership section tabs</div>,
}));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/admin/audit-logs-console', () => ({
  AuditLogsConsole: () => <div>Audit console</div>,
}));
vi.mock('@/components/admin-members-table', () => ({
  MembersTable: ({ initialMembers }: { initialMembers: unknown }) => (
    <pre data-testid="members-table-data">{JSON.stringify(initialMembers)}</pre>
  ),
}));
vi.mock('@/components/invite-member-form', () => ({
  InviteMemberForm: () => <div>Invite member</div>,
}));
vi.mock('@/components/membership-types-admin', () => ({
  MembershipTypesAdmin: () => <div>Membership types editor</div>,
}));
vi.mock('@/components/admin-applications', () => ({
  AdminApplications: () => <div>Applications list</div>,
}));

import AuditLogsPage from '@/app/admin/audit-logs/page';
import EventsAdminPage from '@/app/admin/events/page';
import OrganizerDashboardPage from '@/app/admin/organizer-dashboard/page';
import MembersAdminPage from '@/app/admin/members/page';

const events = [
  {
    id: 'event-1',
    slug: 'social-event',
    title: 'Club Social',
    starts_at: '2099-11-01T12:00:00Z',
    ends_at: null,
    status: 'published',
    capacity: 12,
    price_cents: 2500,
    series_id: null,
    created_by: 'organizer-1',
    organizer_id: 'organizer-1',
  },
];

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', full_name: 'Alex Admin' };
  mocks.rows = {};
  mocks.errors = {};
  mocks.redirect.mockClear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('server-rendered admin pages', () => {
  it('builds member rows from membership payments, family links, activity, notes, and suspensions', async () => {
    mocks.rows.profiles = [
      { id: 'member-paid', full_name: 'Paid Member', email: 'paid@example.test' },
      { id: 'family-one', full_name: null, email: 'family@example.test' },
      { id: 'member-none', full_name: 'No Membership', email: 'none@example.test' },
    ];
    mocks.rows.memberships = [
      {
        id: 'membership-paid',
        user_id: 'member-paid',
        membership_type: 'Family Plan',
        status: 'active',
      },
      {
        id: 'membership-old',
        user_id: 'member-paid',
        membership_type: 'single',
        status: 'inactive',
      },
    ];
    mocks.rows.payments = [
      { business_record_id: 'membership-paid', status: 'succeeded' },
      { business_record_id: 'membership-paid', status: 'pending' },
      { business_record_id: 'membership-old', status: 'refunded' },
    ];
    mocks.rows.registrations = [
      { user_id: 'member-paid', events: { starts_at: '2026-08-01T12:00:00Z' } },
      { user_id: 'member-paid', events: [{ starts_at: '2099-08-01T12:00:00Z' }] },
      { user_id: 'family-one', events: null },
    ];
    mocks.rows.member_admin_notes = [{ user_id: 'member-paid', comment: 'Contact by email' }];
    mocks.rows.member_suspensions = [
      {
        id: 'suspension-1',
        user_id: 'member-paid',
        starts_on: '2026-10-01',
        ends_on: '2026-10-07',
        reason: 'Code of conduct',
        created_at: '2026-09-20',
        cancelled_at: null,
      },
    ];
    mocks.rows.membership_family_members = [
      {
        family_id: 'family-paid',
        user_id: 'family-one',
        status: 'confirmed',
        membership_families: [{ paid_at: '2026-04-01T00:00:00Z', season_year: 2026 }],
      },
      {
        family_id: 'family-paid',
        user_id: 'missing-profile',
        status: 'removed_next_season',
        membership_families: [{ paid_at: '2026-04-01T00:00:00Z', season_year: 2026 }],
      },
    ];

    render(await MembersAdminPage({ searchParams: Promise.resolve({}) }));

    const members = JSON.parse(screen.getByTestId('members-table-data').textContent || '[]');
    expect(members).toEqual([
      expect.objectContaining({
        id: 'member-paid',
        payment_status: 'paid',
        membership_type: 'family',
        last_played: '2026-08-01T12:00:00Z',
        admin_comment: 'Contact by email',
        suspensions: [expect.objectContaining({ id: 'suspension-1', reason: 'Code of conduct' })],
      }),
      expect.objectContaining({
        id: 'family-one',
        payment_status: 'paid',
        membership_type: 'family',
        family_members: ['Member'],
        last_played: null,
      }),
      expect.objectContaining({
        id: 'member-none',
        payment_status: 'unpaid',
        membership_type: 'none',
        family_members: [],
      }),
    ]);
  });

  it('shows the member-query error instead of the member table', async () => {
    mocks.errors.profiles = { message: 'Member directory unavailable.' };
    render(await MembersAdminPage({ searchParams: Promise.resolve({ tab: 'members' }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('Member directory unavailable.');
    expect(screen.queryByTestId('members-table-data')).not.toBeInTheDocument();
  });
  it('restricts audit logs to administrators', async () => {
    mocks.user = null;
    await expect(AuditLogsPage()).rejects.toThrow('redirect:/login?next=/admin/audit-logs');
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member' };
    await expect(AuditLogsPage()).rejects.toThrow('redirect:/member/dashboard');
    mocks.profile = { role: 'admin' };
    render(await AuditLogsPage());
    expect(screen.getByRole('heading', { name: 'Audit & error logs' })).toBeInTheDocument();
    expect(screen.getByText('Audit console')).toBeInTheDocument();
  });

  it('filters organizer event listings and formats event management rows', async () => {
    mocks.user = { id: 'organizer-1' };
    mocks.profile = { role: 'organizer' };
    mocks.rows.events = events;
    const organizerPage = await EventsAdminPage();
    const { container, unmount } = render(organizerPage);
    expect(screen.getByRole('heading', { name: 'Your events' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Club Social' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$25.00' })).toBeInTheDocument();
    unmount();

    mocks.user = { id: 'admin-1' };
    mocks.profile = { role: 'admin' };
    const { container: adminContainer } = render(await EventsAdminPage());
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(adminContainer.querySelector('table')).not.toBeNull();
  });

  it('authorizes organizers and aggregates their upcoming, past, confirmed, and waitlisted events', async () => {
    mocks.user = null;
    await expect(OrganizerDashboardPage()).rejects.toThrow(
      'redirect:/login?next=/admin/organizer-dashboard',
    );
    mocks.user = { id: 'admin-1' };
    mocks.profile = { role: 'admin' };
    await expect(OrganizerDashboardPage()).rejects.toThrow('redirect:/admin/dashboard');
    mocks.profile = { role: 'member' };
    await expect(OrganizerDashboardPage()).rejects.toThrow('redirect:/member/dashboard');

    mocks.user = { id: 'organizer-1' };
    mocks.profile = { role: 'organizer', full_name: 'Jordan Organizer' };
    mocks.rows.events = [
      ...events,
      {
        ...events[0],
        id: 'event-past',
        title: 'Past session',
        starts_at: '2020-01-01T12:00:00Z',
        status: 'cancelled',
      },
    ];
    mocks.rows.registrations = [
      { event_id: 'event-1', status: 'confirmed' },
      { event_id: 'event-1', status: 'waitlisted' },
      { event_id: 'event-past', status: 'confirmed' },
    ];
    const page = await OrganizerDashboardPage();
    const { container } = render(page);
    expect(screen.getByText(/Welcome\s*, Jordan Organizer/)).toBeInTheDocument();
    expect(screen.getByText('Past session')).toBeInTheDocument();
    expect(container).toHaveTextContent('1 waitlisted');
    expect(container).toHaveTextContent('Only sessions created by your account appear here.');
  });

  it('shows organizer query errors, empty states, and the short greeting when no name is set', async () => {
    mocks.user = { id: 'organizer-1' };
    mocks.profile = { role: 'organizer' };
    mocks.errors.events = { message: 'events unavailable' };
    const failed = await OrganizerDashboardPage();
    const failedView = render(failed);
    expect(screen.getByRole('alert')).toHaveTextContent('events unavailable');
    expect(
      screen.getByText('Welcome. This dashboard includes only events you organized.'),
    ).toBeInTheDocument();
    failedView.unmount();

    mocks.errors = {};
    mocks.rows.events = [];
    const empty = await OrganizerDashboardPage();
    const emptyView = render(empty);
    expect(screen.getByText('You have not created any events yet.')).toBeInTheDocument();
    emptyView.unmount();
  });

  it('handles null event and registration collections from the organizer queries', async () => {
    mocks.user = { id: 'organizer-1' };
    mocks.profile = { role: 'organizer', full_name: null };
    mocks.rows.events = null as unknown as unknown[];
    mocks.rows.registrations = null as unknown as unknown[];

    const page = await OrganizerDashboardPage();
    const { container } = render(page);
    expect(container).toHaveTextContent('Your events');
    expect(container).toHaveTextContent('You have not created any events yet.');
    expect(container).toHaveTextContent(
      'Welcome. This dashboard includes only events you organized.',
    );
  });

  it('numbers organizer series sessions and shows each session’s registration counts', async () => {
    mocks.user = { id: 'organizer-1' };
    mocks.profile = { role: 'organizer', full_name: 'Jordan Organizer' };
    mocks.rows.events = [
      {
        ...events[0],
        id: 'session-1',
        slug: 'session-one',
        title: 'Friday Tennis',
        series_id: 'fridays',
        starts_at: '2099-11-01T12:00:00Z',
      },
      {
        ...events[0],
        id: 'session-2',
        slug: 'session-two',
        title: 'Friday Tennis',
        series_id: 'fridays',
        starts_at: '2099-11-08T12:00:00Z',
      },
    ];
    mocks.rows.registrations = [
      { event_id: 'session-2', status: 'confirmed' },
      { event_id: 'session-2', status: 'waitlisted' },
      { event_id: 'session-1', status: 'cancelled' },
    ];

    const { container } = render(await OrganizerDashboardPage());

    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container).toHaveTextContent('1 waitlisted');
    expect(
      screen.getAllByRole('link', { name: 'Manage' }).map((link) => link.getAttribute('href')),
    ).toEqual(['/admin/events/session-one/edit', '/admin/events/session-two/edit']);
  });
});
