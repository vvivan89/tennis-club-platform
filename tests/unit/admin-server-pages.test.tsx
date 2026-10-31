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
        or: () => query,
        order: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.rows[table] ?? [],
            error: mocks.errors[table] ?? null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/admin/audit-logs-console', () => ({
  AuditLogsConsole: () => <div>Audit console</div>,
}));

import AuditLogsPage from '@/app/admin/audit-logs/page';
import EventsAdminPage from '@/app/admin/events/page';
import OrganizerDashboardPage from '@/app/admin/organizer-dashboard/page';

const events = [
  {
    id: 'event-1',
    slug: 'social-event',
    title: 'Club Social',
    starts_at: '2026-11-01T12:00:00Z',
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
});
