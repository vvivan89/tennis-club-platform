import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  rows: {} as Record<string, unknown[]>,
  singles: {} as Record<string, unknown>,
  counts: {} as Record<string, number>,
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: mocks.singles[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.rows[table] ?? [],
            count: mocks.counts[table] ?? null,
            error: null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));

import AdminPage from '@/app/admin/dashboard/page';

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.rows = {};
  mocks.singles = { profiles: { role: 'admin', full_name: 'Alex Admin' } };
  mocks.counts = { profiles: 42, memberships: 3 };
  mocks.redirect.mockClear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('admin dashboard', () => {
  it('redirects anonymous users, organizers, and non-admin members appropriately', async () => {
    mocks.user = null;
    await expect(AdminPage()).rejects.toThrow('redirect:/login?next=/admin/dashboard');
    mocks.user = { id: 'organizer-1' };
    mocks.singles.profiles = { role: 'organizer' };
    await expect(AdminPage()).rejects.toThrow('redirect:/admin/organizer-dashboard');
    mocks.singles.profiles = { role: 'member' };
    await expect(AdminPage()).rejects.toThrow('redirect:/member/dashboard');
  });

  it('aggregates paid and overdue memberships and groups session attendance at cutoff', async () => {
    const now = new Date();
    const eventDate = (offsetDays: number) =>
      new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000).toISOString();
    mocks.rows.profiles = [
      {
        id: 'member-1',
        full_name: 'Alex Member',
        email: 'alex@example.com',
        application_status: 'approved',
      },
      {
        id: 'member-2',
        full_name: 'Jordan Member',
        email: 'jordan@example.com',
        application_status: 'approved',
      },
      {
        id: 'member-3',
        full_name: 'Casey Member',
        email: 'casey@example.com',
        application_status: 'approved',
      },
    ];
    mocks.rows.memberships = [
      {
        id: 'm1',
        user_id: 'member-1',
        status: 'active',
        payment_status: 'unpaid',
        created_at: '2026-01-01',
        ends_on: '2026-12-31',
      },
      {
        id: 'm2',
        user_id: 'member-2',
        status: 'expired',
        payment_status: 'unpaid',
        created_at: '2026-01-02',
        ends_on: '2026-09-30',
      },
      {
        id: 'm3',
        user_id: 'member-3',
        status: 'pending',
        payment_status: 'unpaid',
        created_at: '2026-01-03',
        ends_on: null,
      },
    ];
    mocks.rows.payments = [
      { membership_id: 'm2', status: 'pending' },
      { membership_id: 'm2', status: 'recorded_manually' },
    ];
    mocks.rows.events = [
      {
        id: 'social-1',
        title: 'Autumn Social',
        event_type: 'social',
        starts_at: eventDate(2),
        status: 'published',
        capacity: 1,
        registration_closes_at: eventDate(1),
      },
      {
        id: 'social-2',
        title: ' autumn social ',
        event_type: 'social',
        starts_at: eventDate(-2),
        status: 'published',
        capacity: 4,
        registration_closes_at: null,
      },
      {
        id: 'outside-season',
        title: 'Winter Social',
        starts_at: new Date(now.getFullYear() + 1, 0, 5).toISOString(),
        status: 'published',
        capacity: 8,
        registration_closes_at: null,
      },
    ];
    mocks.singles.membership_plan_settings = {
      season_start_month: 1,
      season_start_day: 1,
      season_end_month: 12,
      season_end_day: 31,
    };
    mocks.rows.registrations = [
      { event_id: 'social-1', user_id: 'member-1', created_at: eventDate(-3) },
      { event_id: 'social-1', user_id: 'member-2', created_at: eventDate(0) },
      { event_id: 'social-1', user_id: 'member-3', created_at: eventDate(2) },
      { event_id: 'social-2', user_id: 'member-1', created_at: eventDate(-3) },
    ];
    mocks.rows.event_waitlist_promotions = [
      { event_id: 'social-1', user_id: 'member-2', promoted_at: eventDate(0) },
      { event_id: 'social-2', user_id: 'member-1', promoted_at: eventDate(0) },
    ];

    const { container } = render(await AdminPage());
    expect(screen.getByText(/Welcome\s*, Alex Admin\./)).toBeInTheDocument();
    const membersCard = screen.getByText('Members').closest('div')?.parentElement;
    expect(membersCard).toHaveTextContent('42');
    expect(
      within(membersCard as HTMLElement).getByText('Paid').nextElementSibling,
    ).toHaveTextContent('1');
    expect(
      within(membersCard as HTMLElement).getByText('Overdue').nextElementSibling,
    ).toHaveTextContent('1');
    expect(
      within(membersCard as HTMLElement).getByText('Pending').nextElementSibling,
    ).toHaveTextContent('3');
    expect(screen.getByText('Published events this season').parentElement).toHaveTextContent('2');
    const overdueRow = screen.getByRole('row', { name: /Alex Member/ });
    expect(within(overdueRow).getByText('active')).toBeInTheDocument();
    expect(within(overdueRow).getByText('2026-12-31')).toBeInTheDocument();
    expect(container.querySelector('[title^="Autumn Social:"]')).toHaveAttribute(
      'title',
      'Autumn Social: 1.5 average registered; 2 sessions; 1.5 average vacant spots; 0.5 average waitlisted without a spot; 0.5 average promoted from waitlist',
    );
    expect(container).not.toHaveTextContent('Winter Social');
  });
});
