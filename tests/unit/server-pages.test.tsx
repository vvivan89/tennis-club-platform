import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { isValidElement, type ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1' } as null | { id: string },
  rows: {} as Record<string, unknown[]>,
  singles: {} as Record<string, unknown>,
  errors: {} as Record<string, { message: string }>,
  paid: false,
  rankingData: null as null | Record<string, unknown>,
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: async () => ({ data: mocks.paid, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed.example/${path}` },
          error: null,
        }),
      }),
    },
    from: (table: string) => {
      let operation = 'select';
      const query = {
        select: () => {
          operation = 'select';
          return query;
        },
        eq: () => query,
        in: () => query,
        or: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: mocks.singles[table] ?? null, error: null }),
        then: (
          resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({
            data: mocks.rows[table] ?? [],
            error: mocks.errors[`${table}.${operation}`] ?? null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/rankings-data', () => ({ getRankingsData: async () => mocks.rankingData }));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/club-site-footer', () => ({ ClubSiteFooter: () => null }));
vi.mock('@/components/documents-browser', () => ({ DocumentsBrowser: 'documents-browser' }));
vi.mock('@/components/events-browser', () => ({ EventsBrowser: 'events-browser' }));
vi.mock('@/components/rankings-table', () => ({ RankingsTable: 'rankings-table' }));
vi.mock('@/components/season-selector', () => ({ SeasonSelector: 'season-selector' }));
vi.mock('@/components/rankings-competition-selector', () => ({
  RankingsCompetitionSelector: 'rankings-competition-selector',
}));
vi.mock('@/components/member-nav', () => ({ MemberNav: () => null }));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/admin-section-tabs', () => ({ AdminSectionTabs: () => null }));
vi.mock('@/components/admin-members-table', () => ({ MembersTable: 'members-table' }));
vi.mock('@/components/invite-member-form', () => ({ InviteMemberForm: () => null }));
vi.mock('@/components/membership-types-admin', () => ({
  MembershipTypesAdmin: 'membership-types-admin',
}));
vi.mock('@/components/admin-applications', () => ({ AdminApplications: 'admin-applications' }));
vi.mock('@/components/auth/auth-form', () => ({ AuthForm: 'auth-form' }));

import DocumentsPage from '@/app/documents/page';
import EventsPage from '@/app/events/page';
import RankingsPage from '@/app/rankings/page';
import MemberResultsPage from '@/app/member/results/page';
import MemberDashboardPage from '@/app/member/dashboard/page';
import AdminMembersPage from '@/app/admin/members/page';
import LoginPage from '@/app/login/page';
import SignupPage from '@/app/signup/page';
import ForgotPasswordPage from '@/app/forgot-password/page';
import TermsPage from '@/app/legal/terms/page';
import DisclaimerPage from '@/app/legal/disclaimer/page';
import PublicationPage from '@/app/publications/[slug]/page';
import ContactsPage from '@/app/contacts/page';
import MyEventsPage from '@/app/my-events/page';
import OrganizerDashboardPage from '@/app/admin/organizer-dashboard/page';

function findElement(
  node: ReactNode,
  type: string,
): React.ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as React.ReactElement<Record<string, unknown>>;
  return findElement((node.props as { children?: React.ReactNode }).children, type);
}

function findHref(
  node: ReactNode,
  href: string,
): React.ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findHref(child, href);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if ((node.props as { href?: string }).href === href)
    return node as React.ReactElement<Record<string, unknown>>;
  return findHref((node.props as { children?: React.ReactNode }).children, href);
}

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.rows = {};
  mocks.errors = {};
  mocks.singles = {};
  mocks.paid = false;
  mocks.redirect.mockClear();
  mocks.rankingData = {
    eligibleUserIds: new Set(['member-1']),
    settings: {
      season_start_month: 4,
      season_start_day: 1,
      season_end_month: 9,
      season_end_day: 30,
    },
    games: [],
    players: [],
    events: [],
    profileById: new Map(),
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('server-rendered data pages', () => {
  it('restricts My events to event-only accounts and groups their entries by event', async () => {
    mocks.user = null;
    await expect(MyEventsPage()).rejects.toThrow('redirect:/login?next=/my-events');

    mocks.user = { id: 'member-1' };
    mocks.singles.profiles = { account_kind: 'member' };
    await expect(MyEventsPage()).rejects.toThrow('redirect:/member/dashboard');

    mocks.singles.profiles = { account_kind: 'event_guest' };
    mocks.rows.tournament_participants = [
      {
        id: 'entry-1',
        event_id: 'event-1',
        category: 'mixed',
        status: 'registered',
        payment_status: 'pending',
        confirmation_status: 'pending',
        event: {
          id: 'event-1',
          slug: 'summer-open',
          title: 'Summer Open',
          starts_at: '2026-08-01T10:00:00Z',
          series_id: null,
        },
      },
      {
        id: 'entry-2',
        event_id: 'event-1',
        category: 'men',
        status: 'registered',
        payment_status: 'paid',
        confirmation_status: 'confirmed',
        event: {
          id: 'event-1',
          slug: 'summer-open',
          title: 'Summer Open',
          starts_at: '2026-08-01T10:00:00Z',
          series_id: null,
        },
      },
      {
        id: 'entry-3',
        event_id: 'event-2',
        category: 'women',
        status: 'registered',
        payment_status: 'pending',
        confirmation_status: 'confirmed',
        event: [
          {
            id: 'event-2',
            slug: null,
            title: 'Club Championship',
            starts_at: '2026-09-01T10:00:00Z',
            series_id: null,
          },
        ],
      },
      {
        id: 'entry-orphan',
        event_id: 'event-orphan',
        category: 'men',
        status: 'registered',
        event: null,
      },
    ];
    const page = await MyEventsPage();
    render(page);
    expect(screen.getByRole('heading', { name: 'My events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Summer Open' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for partner confirmation')).toBeInTheDocument();
    expect(screen.getByText('Registration saved · payment pending')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open event' })[0]).toHaveAttribute(
      'href',
      '/events/summer-open',
    );
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'LI' &&
          element.textContent?.includes('Paid / no payment required') === true,
      ),
    ).toBeInTheDocument();
  });

  it('shows an empty state for an event-only account with no eligible entries', async () => {
    mocks.user = { id: 'guest-1' };
    mocks.singles.profiles = { account_kind: 'event_guest' };
    mocks.rows.tournament_participants = [];
    render(await MyEventsPage());
    expect(screen.getByText('You do not have any event registrations yet.')).toBeInTheDocument();
  });

  it('guards member administration and supplies membership plan defaults and saved settings', async () => {
    mocks.user = null;
    await expect(AdminMembersPage({})).rejects.toThrow('redirect:/login?next=/admin/members');
    mocks.user = { id: 'member-1' };
    mocks.singles.profiles = { role: 'organizer' };
    await expect(AdminMembersPage({})).rejects.toThrow('redirect:/member/dashboard');

    mocks.singles.profiles = { role: 'admin' };
    const defaults = await AdminMembersPage({
      searchParams: Promise.resolve({ tab: 'membership-types' }),
    });
    expect(findElement(defaults, 'membership-types-admin')?.props.initial).toMatchObject({
      single_price_cad: 0,
      family_price_cad: 0,
      family_max_adults: 2,
      family_max_children: 4,
    });

    mocks.singles.membership_plan_settings = {
      single_price_cents: 18000,
      family_price_cents: 26000,
      family_max_adults: 3,
      family_max_children: 5,
      season_start_month: 5,
      season_start_day: 15,
      season_end_month: 10,
      season_end_day: 1,
    };
    const saved = await AdminMembersPage({
      searchParams: Promise.resolve({ tab: 'membership-types' }),
    });
    expect(findElement(saved, 'membership-types-admin')?.props.initial).toMatchObject({
      single_price_cad: 180,
      family_price_cad: 260,
      family_max_adults: 3,
      family_max_children: 5,
      season_start_month: 5,
      season_end_month: 10,
    });
  });

  it('loads pending membership applications and renders query errors', async () => {
    mocks.singles.profiles = { role: 'admin' };
    mocks.rows.profiles = [
      { id: 'application-1', full_name: 'Taylor Applicant', email: 'taylor@example.test' },
    ];
    const applications = await AdminMembersPage({
      searchParams: Promise.resolve({ tab: 'applications' }),
    });
    expect(findElement(applications, 'admin-applications')?.props.applications).toEqual(
      mocks.rows.profiles,
    );

    mocks.errors['profiles.select'] = { message: 'Applications unavailable.' };
    const failed = await AdminMembersPage({
      searchParams: Promise.resolve({ tab: 'applications' }),
    });
    const { container } = render(failed);
    expect(screen.getByRole('alert')).toHaveTextContent('Applications unavailable.');
    expect(container).not.toHaveTextContent('admin-applications');
  });

  it('merges payments, family groups, activity, notes, and suspensions into admin member rows', async () => {
    mocks.user = { id: 'admin-1' };
    mocks.singles.profiles = { role: 'admin' };
    mocks.rows.profiles = [
      { id: 'member-1', full_name: 'Alex Member', email: 'alex@example.com' },
      { id: 'member-2', full_name: 'Jordan Member', email: 'jordan@example.com' },
      { id: 'member-3', full_name: 'Casey Member', email: 'casey@example.com' },
    ];
    mocks.rows.memberships = [
      {
        id: 'membership-1',
        user_id: 'member-1',
        membership_type: 'single',
        payment_status: 'unpaid',
      },
      {
        id: 'membership-2',
        user_id: 'member-2',
        membership_type: 'single',
        payment_status: 'unpaid',
      },
    ];
    mocks.rows.payments = [
      { membership_id: 'membership-1', status: 'paid' },
      { membership_id: 'membership-2', status: 'pending' },
    ];
    mocks.rows.membership_family_members = [
      {
        family_id: 'family-1',
        user_id: 'member-1',
        status: 'confirmed',
        membership_families: [{ paid_at: '2026-04-01', season_year: 2026 }],
      },
      {
        family_id: 'family-1',
        user_id: 'member-2',
        status: 'confirmed',
        membership_families: [{ paid_at: '2026-04-01', season_year: 2026 }],
      },
    ];
    mocks.rows.registrations = [
      { user_id: 'member-1', events: [{ starts_at: '2025-04-01T12:00:00Z' }] },
      { user_id: 'member-1', events: { starts_at: '2026-04-01T12:00:00Z' } },
      { user_id: 'member-1', events: { starts_at: '2999-04-01T12:00:00Z' } },
    ];
    mocks.rows.member_admin_notes = [{ user_id: 'member-3', comment: 'Verify contact details' }];
    mocks.rows.member_suspensions = [
      {
        id: 'suspension-1',
        user_id: 'member-3',
        starts_on: '2026-06-01',
        ends_on: '2026-06-07',
        reason: 'Conduct',
        created_at: '2026-06-01',
        cancelled_at: null,
      },
    ];

    const page = await AdminMembersPage({});
    const rows = findElement(page, 'members-table')?.props.initialMembers as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === 'member-1')).toMatchObject({
      membership_type: 'family',
      payment_status: 'paid',
      family_members: ['Jordan Member'],
      last_played: '2026-04-01T12:00:00Z',
    });
    expect(rows.find((row) => row.id === 'member-2')).toMatchObject({
      membership_type: 'family',
      payment_status: 'paid',
      family_members: ['Alex Member'],
    });
    expect(rows.find((row) => row.id === 'member-3')).toMatchObject({
      membership_type: 'none',
      payment_status: 'unpaid',
      admin_comment: 'Verify contact details',
      suspensions: [expect.objectContaining({ id: 'suspension-1', reason: 'Conduct' })],
    });
  });

  it('reports member directory query errors without rendering a partial directory', async () => {
    mocks.user = { id: 'admin-1' };
    mocks.singles.profiles = { role: 'admin' };
    mocks.errors['profiles.select'] = { message: 'Member directory unavailable.' };

    const page = await AdminMembersPage({});
    const { container } = render(page);

    expect(screen.getByRole('alert')).toHaveTextContent('Member directory unavailable.');
    expect(container).not.toHaveTextContent('members-table');
  });

  it('handles incomplete member billing and activity records without exposing unapproved accounts', async () => {
    mocks.user = { id: 'admin-1' };
    mocks.singles.profiles = { role: 'admin' };
    mocks.rows.profiles = [
      { id: 'member-1', full_name: null, email: 'one@example.test' },
      { id: 'member-2', full_name: 'Jordan Member', email: 'jordan@example.test' },
    ];
    mocks.rows.memberships = [
      {
        id: 'membership-1',
        user_id: 'member-1',
        membership_type: 'Family Plus',
        payment_status: null,
      },
    ];
    mocks.rows.payments = [
      { business_record_id: null, status: 'succeeded' },
      { business_record_id: 'membership-1', status: 'failed' },
      { business_record_id: 'membership-1', status: 'refunded' },
    ];
    mocks.rows.membership_family_members = [
      {
        family_id: 'family-1',
        user_id: 'member-1',
        status: 'removed_next_season',
        membership_families: { paid_at: null, season_year: 2026 },
      },
      {
        family_id: 'family-1',
        user_id: 'member-2',
        status: 'confirmed',
        membership_families: null,
      },
    ];
    mocks.rows.registrations = [
      { user_id: 'member-1', events: null },
      { user_id: 'member-1', events: { starts_at: null } },
      { user_id: 'member-1', events: { starts_at: '2000-01-01T12:00:00Z' } },
    ];
    mocks.rows.member_suspensions = [
      {
        id: 'suspension-1',
        user_id: 'member-1',
        starts_on: '2026-01-01',
        ends_on: null,
        reason: 'First',
        created_at: '2026-01-01',
        cancelled_at: null,
      },
      {
        id: 'suspension-2',
        user_id: 'member-1',
        starts_on: '2026-02-01',
        ends_on: null,
        reason: 'Second',
        created_at: '2026-02-01',
        cancelled_at: null,
      },
    ];

    const page = await AdminMembersPage({});
    const rows = findElement(page, 'members-table')?.props.initialMembers as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      membership_type: 'family',
      payment_status: 'unpaid',
      family_members: ['Jordan Member'],
      suspensions: [
        expect.objectContaining({ id: 'suspension-1' }),
        expect.objectContaining({ id: 'suspension-2' }),
      ],
    });
    expect(rows[1]).toMatchObject({
      membership_type: 'family',
      family_members: ['one@example.test'],
    });
  });

  it('redirects anonymous dashboard visitors and shows application status for unapproved members', async () => {
    mocks.user = null;
    await expect(MemberDashboardPage()).rejects.toThrow('redirect:/login?next=/dashboard');

    mocks.user = { id: 'member-1' };
    mocks.singles.profiles = { application_status: 'dismissed' };
    const page = await MemberDashboardPage();
    const { container } = render(page);
    expect(screen.getByRole('heading', { name: 'Application not approved' })).toBeInTheDocument();
    expect(container).toHaveTextContent('Please contact the club if you have questions.');
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events');
  });

  it('summarizes approved member activity and displays active suspension and birthday status', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const birthday = new Date();
    const pastEvent = {
      id: 'past',
      slug: 'past-event',
      title: 'Past Event',
      starts_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const futureEvent = {
      id: 'future',
      slug: 'future-event',
      title: 'Future Event',
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    mocks.singles.profiles = {
      full_name: 'Alex Member',
      role: 'organizer',
      date_of_birth: `2000-${String(birthday.getMonth() + 1).padStart(2, '0')}-${String(birthday.getDate()).padStart(2, '0')}`,
      show_birthday_emoji: true,
      tennis_skill_level: 3.5,
      application_status: 'approved',
    };
    mocks.rows.registrations = [
      { id: 'r1', event_id: 'past', status: 'confirmed', event: pastEvent },
      { id: 'r2', event_id: 'future', status: 'confirmed', event: [futureEvent] },
      { id: 'r3', event_id: 'future', status: 'waitlisted', event: futureEvent },
      { id: 'r4', event_id: 'future', status: 'cancelled', event: futureEvent },
    ];
    mocks.rows.member_suspensions = [
      { id: 's1', starts_on: today, ends_on: today, reason: 'Court conduct review' },
    ];

    const { container } = render(await MemberDashboardPage());
    expect(screen.getByRole('heading', { name: /Welcome, Alex Member/ })).toHaveTextContent('🎂');
    expect(screen.getByText('Organizer')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Court conduct review');
    expect(container).toHaveTextContent('Past events attended');
    expect(screen.getByText('Past events attended').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Upcoming registrations').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Waitlisted').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Cancelled registrations').nextElementSibling).toHaveTextContent('1');
    expect(screen.getAllByRole('link', { name: /Future Event/ })).toHaveLength(2);
    expect(
      screen
        .getAllByRole('link', { name: /Future Event/ })
        .every((link) => link.getAttribute('href') === '/events/future-event'),
    ).toBe(true);
  });

  it('shows organizer-specific empty and populated event dashboards', async () => {
    mocks.user = { id: 'organizer-1' };
    mocks.singles.profiles = { role: 'organizer', full_name: null };
    mocks.rows.events = [];
    mocks.rows.registrations = [];
    const emptyPage = await OrganizerDashboardPage();
    const empty = render(emptyPage);
    expect(
      screen.getByText('Welcome. This dashboard includes only events you organized.'),
    ).toBeInTheDocument();
    expect(screen.getByText('You have not created any events yet.')).toBeInTheDocument();
    empty.unmount();

    const now = new Date();
    mocks.rows.events = [
      {
        id: 'organizer-event',
        slug: 'organizer-event',
        title: 'Club session',
        starts_at: new Date(now.getTime() + 86_400_000).toISOString(),
        ends_at: null,
        status: 'published',
        capacity: 12,
        price_cents: 0,
        series_id: null,
        created_by: 'organizer-1',
        organizer_id: null,
      },
    ];
    mocks.rows.registrations = [
      { event_id: 'organizer-event', status: 'confirmed' },
      { event_id: 'organizer-event', status: 'waitlisted' },
      { event_id: 'organizer-event', status: 'cancelled' },
    ];
    const populated = render(await OrganizerDashboardPage());
    expect(screen.getByText('Club session')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/admin/events/organizer-event/edit',
    );
    expect(screen.getByText('Club session').closest('tr')).toHaveTextContent('1 · 1 waitlisted');
    populated.unmount();

    mocks.singles.profiles = { role: 'admin' };
    await expect(OrganizerDashboardPage()).rejects.toThrow('redirect:/admin/dashboard');
    mocks.singles.profiles = { role: 'member' };
    await expect(OrganizerDashboardPage()).rejects.toThrow('redirect:/member/dashboard');
  });

  it('shows family invitation status and family members on an approved dashboard', async () => {
    mocks.singles.profiles = { full_name: 'Alex Member', application_status: 'approved' };
    mocks.singles.membership_family_members = { family_id: 'family-1', status: 'pending' };
    mocks.singles.membership_families = { paid_at: null, payment_id: null, season_year: 2026 };
    mocks.rows.membership_family_members = [
      { profiles: [{ full_name: 'Alex Member' }] },
      { profiles: [{ email: 'jordan@example.com' }] },
    ];

    const { container } = render(await MemberDashboardPage());
    expect(container).toHaveTextContent('Family invitation pending');
    expect(container).toHaveTextContent('Family membership unpaid');
    expect(container).toHaveTextContent('Family members');
    expect(container).toHaveTextContent('Alex Member');
    expect(container).toHaveTextContent('jordan@example.com');
    expect(container).toHaveTextContent('You have no event registrations yet.');
  });

  it('shows a removed-next-season family as paid and falls back for missing family member names', async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 3, 1);
    const end = new Date(now.getFullYear(), 8, 30, 23, 59, 59, 999);
    const seasonYear =
      now < start ? now.getFullYear() : now > end ? now.getFullYear() + 1 : now.getFullYear();
    mocks.singles.profiles = { application_status: 'approved' };
    mocks.singles.membership_family_members = {
      family_id: 'family-leaving',
      status: 'removed_next_season',
    };
    mocks.singles.membership_families = {
      paid_at: null,
      payment_id: 'family-payment',
      season_year: seasonYear,
    };
    mocks.rows.membership_family_members = [{ profiles: [] }];

    const { container } = render(await MemberDashboardPage());

    expect(container).toHaveTextContent('Family membership · leaving next season');
    expect(container).toHaveTextContent('Family membership paid');
    expect(container).toHaveTextContent('Family members');
    expect(container).toHaveTextContent('Member');
    expect(container).toHaveTextContent('No event registration history yet.');
    expect(
      screen.getByText('Tennis skill level: Not set — update your profile'),
    ).toBeInTheDocument();
  });

  it('shows previous-season billing defaults and handles empty member activity without a name', async () => {
    mocks.singles.profiles = { application_status: 'approved', role: 'admin' };
    mocks.singles.memberships = {
      id: 'old-membership',
      membership_type: 'single',
      payment_status: 'unpaid',
      starts_on: '2020-04-01',
      ends_on: '2020-09-30',
    };
    mocks.rows.registrations = [
      { id: 'missing-event', event_id: 'event-gone', status: 'cancelled', event: null },
    ];

    const { container } = render(await MemberDashboardPage());

    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(container).toHaveTextContent('Previous-season membership');
    expect(container).toHaveTextContent('No payment recorded for the current season');
    expect(container).toHaveTextContent('April 1 – September 30');
    expect(screen.queryByRole('link', { name: /Event/ })).not.toBeInTheDocument();
    expect(container).toHaveTextContent('No event registration history yet.');
  });

  it('uses legacy family membership and payment fallbacks for dashboard billing details', async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 4, 15);
    const end = new Date(now.getFullYear(), 9, 1);
    const seasonYear =
      now < start ? now.getFullYear() : now > end ? now.getFullYear() + 1 : now.getFullYear();
    mocks.singles.profiles = {
      full_name: 'Alex Admin',
      role: 'admin',
      application_status: 'approved',
      show_birthday_emoji: false,
    };
    mocks.singles.memberships = {
      id: 'membership-1',
      membership_type: 'family_plus',
      payment_status: 'paid',
      created_at: '2026-01-01T00:00:00Z',
      starts_on: `${seasonYear}-05-15`,
      ends_on: `${seasonYear}-10-01`,
    };
    mocks.singles.membership_plan_settings = {
      single_price_cents: 12000,
      family_price_cents: 31000,
      season_start_month: 5,
      season_start_day: 15,
      season_end_month: 10,
      season_end_day: 1,
    };
    mocks.singles.payments = {
      business_record_id: 'membership-1',
      paid_at: null,
      created_at: '2026-04-20T00:00:00Z',
    };

    const { container } = render(await MemberDashboardPage());
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(container).toHaveTextContent('Family membership');
    expect(container).toHaveTextContent('Membership paid');
    expect(container).toHaveTextContent('$310.00');
    expect(container).toHaveTextContent('May 15 – October 1');
    expect(container).toHaveTextContent(
      new Date('2026-04-20T00:00:00Z').toLocaleDateString('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    );
  });

  it('redirects anonymous/unapproved/unpaid document readers before querying documents', async () => {
    mocks.user = null;
    await expect(DocumentsPage()).rejects.toThrow('redirect:/login?next=/documents');

    mocks.user = { id: 'member-1' };
    mocks.singles.profiles = { role: 'member', application_status: 'pending' };
    await expect(DocumentsPage()).rejects.toThrow('redirect:/member/dashboard');

    mocks.singles.profiles = { role: 'member', application_status: 'approved' };
    mocks.paid = false;
    await expect(DocumentsPage()).rejects.toThrow('redirect:/events');
  });

  it('signs document URLs for approved ever-paid members and lets admins bypass payment history', async () => {
    mocks.singles.profiles = { role: 'member', application_status: 'approved' };
    mocks.paid = true;
    mocks.rows.documents = [
      {
        id: 'doc-1',
        title: 'Minutes',
        description: null,
        storage_path: 'minutes.pdf',
        created_at: '2025-01-01',
      },
    ];
    const memberPage = await DocumentsPage();
    const memberBrowser = findElement(memberPage, 'documents-browser');
    expect(memberBrowser?.props.documents).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        description: '',
        downloadUrl: 'https://signed.example/minutes.pdf',
      }),
    ]);

    mocks.singles.profiles = { role: 'admin', application_status: 'approved' };
    mocks.paid = false;
    expect(findElement(await DocumentsPage(), 'documents-browser')).not.toBeNull();
  });

  it('redirects ineligible ranking viewers and accepts only valid available season requests', async () => {
    mocks.user = null;
    await expect(RankingsPage({})).rejects.toThrow('redirect:/login?next=/rankings');

    mocks.user = { id: 'member-1' };
    mocks.singles.profiles = { application_status: 'pending', role: 'member' };
    await expect(RankingsPage({})).rejects.toThrow('redirect:/member/dashboard');

    mocks.singles.profiles = { application_status: 'approved', role: 'member' };
    (mocks.rankingData as { eligibleUserIds: Set<string> }).eligibleUserIds = new Set();
    await expect(RankingsPage({})).rejects.toThrow('redirect:/member/dashboard');

    (mocks.rankingData as { eligibleUserIds: Set<string> }).eligibleUserIds = new Set(['member-1']);
    (mocks.rankingData as { games: unknown[] }).games = [
      {
        id: 'g1',
        playedAt: `${new Date().getFullYear()}-06-01T12:00:00Z`,
        playerIds: ['member-1'],
        sideOneIds: ['member-1'],
        sideTwoIds: [],
        scoreOne: 6,
        scoreTwo: 2,
      },
    ];
    const valid = await RankingsPage({ searchParams: Promise.resolve({ season: 'all' }) });
    const validSelector = findElement(valid, 'rankings-table')?.props.competitionSelector;
    expect(isValidElement(validSelector)).toBe(true);
    expect((validSelector as React.ReactElement<{ value: string }>).props.value).toBe('all');
    const invalid = await RankingsPage({ searchParams: Promise.resolve({ season: 'bogus' }) });
    const invalidSelector = findElement(invalid, 'rankings-table')?.props.competitionSelector;
    expect(isValidElement(invalidSelector)).toBe(true);
    expect((invalidSelector as React.ReactElement<{ value: string }>).props.value).not.toBe(
      'bogus',
    );
  });

  it('builds ladder rankings with current results, full carryover, and seeded players', async () => {
    mocks.singles.profiles = { application_status: 'approved', role: 'admin' };
    mocks.rows.social_doubles_ladders = [
      {
        id: 'previous',
        name: 'Spring Ladder',
        gender: 'male',
        position_points: [4, 2, -1, -2],
        ranking_priority: ['games_won'],
        starts_at: '2026-01-01',
        ends_at: '2026-06-01',
        carryover_mode: 'none',
        previous_ladder_id: null,
      },
      {
        id: 'current',
        name: 'Summer Ladder',
        gender: 'male',
        position_points: [3, 1, -1, -3],
        ranking_priority: ['sets_won', 'games_difference'],
        starts_at: '2026-06-02',
        ends_at: null,
        carryover_mode: 'full',
        previous_ladder_id: 'previous',
      },
    ];
    mocks.rows.events = [
      { id: 'previous-event', social_doubles_ladder_id: 'previous' },
      { id: 'current-event', social_doubles_ladder_id: 'current' },
    ];
    const makeGame = (id: string, eventId: string, scoreOne: number, scoreTwo: number) => ({
      id,
      eventId,
      playedAt: '2026-06-10T12:00:00Z',
      playerIds: ['p1', 'p2', 'p3', 'p4'],
      sideOneIds: ['p1', 'p2'],
      sideTwoIds: ['p3', 'p4'],
      scoreOne,
      scoreTwo,
    });
    const rankingData = mocks.rankingData as {
      players: unknown[];
      games: unknown[];
      events: unknown[];
      profileById: Map<string, string>;
    };
    rankingData.players = ['p1', 'p2', 'p3', 'p4'].map((id) => ({
      id,
      fullName: `Player ${id}`,
      skillLevel: 3,
      gender: 'male',
    }));
    rankingData.profileById = new Map(['p1', 'p2', 'p3', 'p4'].map((id) => [id, `Player ${id}`]));
    rankingData.games = [
      makeGame('old-match', 'previous-event', 6, 2),
      makeGame('new-match', 'current-event', 6, 3),
    ];
    rankingData.events = [
      { id: 'previous-event', social_doubles_ladder_id: 'previous' },
      { id: 'current-event', social_doubles_ladder_id: 'current' },
    ];
    mocks.rows.social_doubles_ladder_seeds = [
      { user_id: 'p1', initial_position: 1, initial_points: 7 },
      { user_id: 'p4', initial_position: 4, initial_points: 2 },
      { user_id: 'p5', initial_position: 5, initial_points: 9 },
    ];

    const page = await RankingsPage({ searchParams: Promise.resolve({ ladder: 'current' }) });
    const table = findElement(page, 'rankings-table');
    const selector = table?.props.competitionSelector;
    expect(isValidElement(selector)).toBe(true);
    expect((selector as React.ReactElement<{ value: string }>).props.value).toBe('ladder:current');
    const ladderPoints = table?.props.ladderPoints as Map<string, number>;
    expect(ladderPoints.get('p1')).toEqual(expect.any(Number));
    expect(ladderPoints.get('p4')).toEqual(expect.any(Number));
    expect(ladderPoints.get('p5')).toBe(9);
    expect(table?.props.ladderSeedOrder).toBeInstanceOf(Map);
    expect((table?.props.ladderSeedOrder as Map<string, number>).get('p1')).toBe(1);
    expect(
      (selector as React.ReactElement<{ options: { value: string }[] }>).props.options.filter(
        (option) => option.value.startsWith('ladder:'),
      ),
    ).toHaveLength(2);
  });

  it('renders a full-carryover ladder when its configured previous ladder is missing', async () => {
    mocks.singles.profiles = { application_status: 'approved', role: 'admin' };
    mocks.rows.social_doubles_ladders = [
      {
        id: 'orphan-current',
        name: 'Current Ladder',
        gender: 'female',
        position_points: [2, 1, -1, -2],
        ranking_priority: ['games_won'],
        starts_at: '2026-06-01',
        ends_at: null,
        carryover_mode: 'full',
        previous_ladder_id: 'deleted-previous',
      },
    ];
    mocks.rows.events = [{ id: 'current-event', social_doubles_ladder_id: 'orphan-current' }];
    const rankingData = mocks.rankingData as {
      players: unknown[];
      games: unknown[];
      events: unknown[];
      profileById: Map<string, string>;
    };
    rankingData.players = [{ id: 'p1', fullName: 'Player One', skillLevel: 3, gender: 'female' }];
    rankingData.profileById = new Map([['p1', 'Player One']]);
    rankingData.games = [];
    rankingData.events = [{ id: 'current-event', social_doubles_ladder_id: 'orphan-current' }];

    const page = await RankingsPage({
      searchParams: Promise.resolve({ ladder: 'orphan-current' }),
    });
    const table = findElement(page, 'rankings-table');
    expect(table?.props.ladderPoints).toBeInstanceOf(Map);
    expect(table?.props.ladderSeedOrder).toBeInstanceOf(Map);
  });

  it('offers only doubles tournaments with a completed result in the competition selector', async () => {
    mocks.singles.profiles = { application_status: 'approved', role: 'admin' };
    const tournament = (id: string, title: string) => ({
      id,
      title,
      slug: id,
      starts_at: '2026-06-01T12:00:00Z',
      ends_at: '2026-06-01T20:00:00Z',
      status: 'published',
      event_type: 'tournament',
      tournament_format: 'doubles',
      tournament_config: {},
      tournament_rules_html: '',
      tournament_details_public: true,
      allow_non_member_registration: false,
      registration_opens_at: '2026-05-01T00:00:00Z',
      registration_closes_at: null,
      price_cents: 0,
      location: null,
      court_count: 2,
    });
    mocks.rows.events = [
      tournament('no-results', 'No Results Open'),
      tournament('has-results', 'Results Open'),
    ];
    mocks.rows.tournament_matches = [
      { event_id: 'has-results', status: 'completed', score_sets: [], winner_side: 1 },
    ];

    const page = await RankingsPage({});
    const table = findElement(page, 'rankings-table');
    const selector = table?.props.competitionSelector;
    expect(isValidElement(selector)).toBe(true);
    const options = (selector as React.ReactElement<{ options: { value: string }[] }>).props
      .options;
    expect(options.map((option) => option.value)).toContain('tournament:has-results');
    expect(options.map((option) => option.value)).not.toContain('tournament:no-results');
  });

  it('splits upcoming and past events and exposes event creation only to approved managers', async () => {
    mocks.rows.events = [
      {
        id: 'future',
        title: 'Future',
        starts_at: '2999-01-01T00:00:00Z',
        ends_at: null,
        status: 'published',
      },
      {
        id: 'past',
        title: 'Past',
        starts_at: '2000-01-01T00:00:00Z',
        ends_at: null,
        status: 'cancelled',
      },
    ];
    mocks.singles.profiles = { role: 'admin', application_status: 'approved' };
    const page = await EventsPage();
    const browser = findElement(page, 'events-browser');
    expect(browser?.props.events).toHaveLength(1);
    expect(browser?.props.pastEvents).toHaveLength(1);
    expect(findHref(page, '/admin/events/create')).not.toBeNull();

    mocks.singles.profiles = { role: 'member', application_status: 'approved' };
    const memberPage = await EventsPage();
    expect(findElement(memberPage, 'events-browser')).not.toBeNull();
    expect(findHref(memberPage, '/admin/events/create')).toBeNull();
  });

  it('guards member results by approval and payment eligibility, then renders match summaries', async () => {
    mocks.user = null;
    await expect(MemberResultsPage({})).rejects.toThrow('redirect:/login?next=/member/results');

    mocks.user = { id: 'member-1' };
    mocks.singles.profiles = { application_status: 'pending', role: 'member' };
    await expect(MemberResultsPage({})).rejects.toThrow('redirect:/member/dashboard');

    mocks.singles.profiles = {
      full_name: 'Alex Member',
      application_status: 'approved',
      role: 'member',
    };
    (mocks.rankingData as { eligibleUserIds: Set<string> }).eligibleUserIds = new Set();
    await expect(MemberResultsPage({})).rejects.toThrow('redirect:/member/dashboard');

    (mocks.rankingData as { eligibleUserIds: Set<string> }).eligibleUserIds = new Set(['member-1']);
    (mocks.rankingData as { players: unknown[] }).players = [
      {
        id: 'member-1',
        name: 'Alex Member',
        gender: 'male',
        skillRating: 3.5,
        gamesWon: 6,
        gamesLost: 2,
        setsWon: 1,
        setsLost: 0,
        gamesPercentage: 75,
        setsPercentage: 100,
        gamesPlayed: 1,
      },
    ];
    (mocks.rankingData as { games: unknown[] }).games = [
      {
        id: 'score-1',
        eventTitle: 'Opening Social',
        playedAt: `${new Date().getFullYear()}-06-01T12:00:00Z`,
        playerIds: ['member-1', 'opponent-1'],
        sideOneIds: ['member-1'],
        sideTwoIds: ['opponent-1'],
        scoreOne: 6,
        scoreTwo: 2,
      },
    ];
    (mocks.rankingData as { profileById: Map<string, string> }).profileById = new Map([
      ['opponent-1', 'Opponent One'],
    ]);
    const page = await MemberResultsPage({ searchParams: Promise.resolve({ season: 'all' }) });
    expect(findElement(page, 'rankings-competition-selector')?.props.value).toBe('all');
    const { container } = render(page);
    expect(container).toHaveTextContent('Opening Social');
    expect(container).toHaveTextContent('Opponent One');
  });

  it('shows an unranked empty state for members without results or a gender profile', async () => {
    mocks.singles.profiles = {
      full_name: null,
      application_status: 'approved',
      role: 'member',
    };
    (mocks.rankingData as { eligibleUserIds: Set<string> }).eligibleUserIds = new Set(['member-1']);
    const page = await MemberResultsPage({
      searchParams: Promise.resolve({ season: ['nonsense', 'all'] }),
    });
    expect(findElement(page, 'rankings-competition-selector')?.props.value).not.toBe('nonsense');
    const { container } = render(page);
    expect(container).toHaveTextContent('Not ranked');
    expect(container).not.toHaveTextContent('Men’s ranking');
    expect(container).toHaveTextContent('0.0%');
    expect(container).toHaveTextContent('No recorded scores for this period.');
  });

  it('filters member results to a selected tournament and exposes only participated competitions', async () => {
    mocks.singles.profiles = {
      full_name: 'Alex Member',
      application_status: 'approved',
      role: 'admin',
    };
    (mocks.rankingData as { players: unknown[] }).players = [
      {
        id: 'member-1',
        name: 'Alex Member',
        gender: 'male',
        skillRating: 4,
        gamesWon: 4,
        gamesLost: 1,
        setsWon: 2,
        setsLost: 0,
        gamesPercentage: 80,
        setsPercentage: 100,
        gamesPlayed: 1,
      },
    ];
    (mocks.rankingData as { games: unknown[] }).games = [
      {
        id: 'tournament-score',
        eventId: 'tournament-1',
        eventTitle: 'Doubles Open',
        playedAt: '2026-06-12T12:00:00Z',
        playerIds: ['member-1'],
        sideOneIds: ['member-1'],
        sideTwoIds: ['opponent-1'],
        scoreOne: 6,
        scoreTwo: 3,
      },
      {
        id: 'ladder-score',
        eventId: 'ladder-event-1',
        eventTitle: 'Friday Ladder',
        playedAt: '2026-06-13T12:00:00Z',
        playerIds: ['member-1'],
        sideOneIds: ['member-1'],
        sideTwoIds: ['opponent-1'],
        scoreOne: 2,
        scoreTwo: 6,
      },
    ];
    (mocks.rankingData as { events: unknown[] }).events = [
      { id: 'ladder-event-1', social_doubles_ladder_id: 'ladder-1' },
    ];
    mocks.rows.registrations = [{ event_id: 'tournament-1' }];
    mocks.rows.tournament_participants = [];
    mocks.rows.social_doubles_ladders = [
      { id: 'ladder-1', name: 'Friday Ladder', gender: 'male', competition_type: 'ladder' },
      { id: 'league-1', name: 'Spring League', gender: 'male', competition_type: 'league' },
    ];
    mocks.rows.events = [{ id: 'tournament-1', title: 'Doubles Open', tournament_config: {} }];
    mocks.rows.tournament_matches = [
      { event_id: 'tournament-1', status: 'completed', score_sets: [], winner_side: 1 },
      { event_id: 'ignored-tournament', status: 'scheduled', score_sets: [], winner_side: null },
    ];
    (mocks.rankingData as { profileById: Map<string, string> }).profileById = new Map([
      ['opponent-1', 'Opponent'],
    ]);

    const page = await MemberResultsPage({
      searchParams: Promise.resolve({ tournament: 'tournament-1', season: 'invalid' }),
    });
    expect(findElement(page, 'rankings-competition-selector')?.props.value).toBe(
      'tournament:tournament-1',
    );
    const { container } = render(page);
    expect(container).toHaveTextContent('Doubles Open');
    expect(container).not.toHaveTextContent('Friday Ladder');
    expect(container).toHaveTextContent('Won');
  });

  it('selects a valid season and renders wins and draws when the player was on side two', async () => {
    mocks.singles.profiles = {
      full_name: 'Alex Member',
      application_status: 'approved',
      role: 'member',
    };
    (mocks.rankingData as { players: unknown[] }).players = [
      {
        id: 'member-1',
        name: 'Alex Member',
        gender: 'female',
        skillRating: null,
        gamesWon: 0,
        gamesLost: 0,
        setsWon: 0,
        setsLost: 0,
        gamesPercentage: 0,
        setsPercentage: 0,
        gamesPlayed: 0,
      },
    ];
    (mocks.rankingData as { games: unknown[] }).games = [
      {
        id: 'side-two-win',
        eventTitle: 'Side Two Win',
        playedAt: `${new Date().getFullYear()}-06-01T12:00:00Z`,
        playerIds: ['member-1', 'opponent-1'],
        sideOneIds: ['opponent-1'],
        sideTwoIds: ['member-1'],
        scoreOne: 4,
        scoreTwo: 6,
      },
      {
        id: 'draw',
        eventTitle: 'Draw Match',
        playedAt: `${new Date().getFullYear()}-06-02T12:00:00Z`,
        playerIds: ['member-1'],
        sideOneIds: ['member-1'],
        sideTwoIds: [],
        scoreOne: 3,
        scoreTwo: 3,
      },
      {
        id: 'side-two-loss',
        eventTitle: 'Side Two Loss',
        playedAt: `${new Date().getFullYear()}-06-03T12:00:00Z`,
        playerIds: ['member-1', 'opponent-1'],
        sideOneIds: ['opponent-1'],
        sideTwoIds: ['member-1'],
        scoreOne: 6,
        scoreTwo: 2,
      },
    ];

    const page = await MemberResultsPage({
      searchParams: Promise.resolve({ season: String(new Date().getFullYear()) }),
    });
    expect(findElement(page, 'rankings-competition-selector')?.props.value).toBe(
      String(new Date().getFullYear()),
    );
    const { container } = render(page);
    expect(container).toHaveTextContent('Women’s ranking');
    expect(container).toHaveTextContent('Side Two Win');
    expect(container).toHaveTextContent('6–4');
    expect(container).toHaveTextContent('Won');
    expect(container).toHaveTextContent('Draw Match');
    expect(container).toHaveTextContent('Draw');
    expect(container).toHaveTextContent('Side Two Loss');
    expect(container).toHaveTextContent('Lost');
    expect(container).toHaveTextContent('Opponent');
    expect(container).toHaveTextContent('—');
  });

  it('wires login, signup, and reset pages to the correct auth modes', () => {
    expect(findElement(LoginPage(), 'auth-form')?.props.mode).toBe('login');
    expect(findElement(SignupPage(), 'auth-form')?.props.mode).toBe('signup');
    expect(findElement(ForgotPasswordPage(), 'auth-form')?.props.mode).toBe('reset');
  });

  it('renders the published legal document and a safe fallback when none exists', async () => {
    mocks.singles.legal_document_versions = {
      title: 'Club Terms',
      body_html: '<p>Published text</p>',
      version: 3,
      created_at: '2026-01-15T00:00:00Z',
    };
    const terms = await TermsPage();
    const { container, unmount } = render(terms);
    expect(screen.getByRole('heading', { name: 'Club Terms' })).toBeInTheDocument();
    expect(container.querySelector('.prose')).toHaveTextContent('Published text');
    unmount();

    mocks.singles.legal_document_versions = null;
    const disclaimer = await DisclaimerPage();
    const fallback = render(disclaimer);
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(fallback.container.querySelector('.prose')).toHaveTextContent(
      'Disclaimer has not been published yet.',
    );
  });

  it('resolves published articles from readable slugs and returns not-found for unknown slugs', async () => {
    mocks.rows.news = [
      {
        id: 'news-1',
        title: 'Season Opening',
        body: '<p>Welcome back</p>',
        published_at: '2026-04-01T00:00:00Z',
      },
    ];
    mocks.singles.club_settings = { club_name: 'Club', short_name: 'C', social_links: [] };
    const article = await PublicationPage({ params: Promise.resolve({ slug: 'season_opening' }) });
    const { container } = render(article);
    expect(screen.getByRole('heading', { name: 'Season Opening' })).toBeInTheDocument();
    expect(container.querySelector('.prose')).toHaveTextContent('Welcome back');

    mocks.rows.news = [];
    await expect(PublicationPage({ params: Promise.resolve({ slug: 'missing' }) })).rejects.toThrow(
      'not-found',
    );
  });

  it('renders club contact mail/phone/map/social links with formatted phone values', async () => {
    mocks.singles.club_settings = {
      club_name: 'Club',
      short_name: 'C',
      description: 'Contact the club',
      contact_email: 'info@example.com',
      contact_phone: '6045550100',
      location_url: 'https://maps.example/club',
      location_query: 'Port Coquitlam Tennis Club',
      social_links: [
        { url: 'https://instagram.com/example' },
        { url: 'https://facebook.com/example' },
        { url: 'https://x.com/example' },
        { url: 'https://youtube.com/example' },
        { url: 'https://linkedin.com/example' },
        { url: 'https://tiktok.com/example' },
        { url: 'https://example.org/club' },
      ],
    };
    mocks.rows.public_club_contacts = [
      {
        id: 'contact-1',
        position: 'Treasurer',
        emails: ['treasurer@example.com'],
        phones: ['6045550199'],
        sort_order: 1,
        full_name: 'Club Treasurer',
        avatar_url: 'https://images.example/treasurer.png',
        is_public: true,
      },
    ];
    const page = await ContactsPage();
    const { container } = render(page);
    expect(screen.getByRole('heading', { name: 'Contact Club' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'info@example.com' })).toHaveAttribute(
      'href',
      'mailto:info@example.com',
    );
    expect(screen.getByText('604.555.0100')).toBeInTheDocument();
    expect(screen.getByText('Club Treasurer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open location in Google Maps' })).toHaveAttribute(
      'href',
      'https://maps.example/club',
    );
    expect(container.querySelector('iframe')).toHaveAttribute(
      'src',
      expect.stringContaining('Port%20Coquitlam'),
    );
    expect(screen.getByRole('link', { name: 'Club social link 1' })).toHaveAttribute(
      'href',
      'https://instagram.com/example',
    );
    expect(screen.getByRole('link', { name: 'Club social link 7' })).toHaveAttribute(
      'href',
      'https://example.org/club',
    );
    expect(screen.getByRole('link', { name: '604.555.0199' })).toHaveAttribute(
      'href',
      'tel:6045550199',
    );
  });

  it('uses safe club defaults when settings and public contacts are absent', async () => {
    mocks.singles.club_settings = null;
    mocks.rows.public_club_contacts = [];
    const page = await ContactsPage();
    const { container } = render(page);
    expect(
      screen.getByRole('heading', { name: 'Contact Port Coquitlam Tennis Club' }),
    ).toBeInTheDocument();
    expect(screen.getByText('General contact details have not been added.')).toBeInTheDocument();
    expect(
      screen.getByText('Add a club address or place name in Club Profile to show the map.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Club executives and contacts' }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders a selected league table and filters standings with unavailable player profiles', async () => {
    mocks.singles.profiles = { application_status: 'approved', role: 'member' };
    mocks.rows.social_doubles_ladders = [
      {
        id: 'league-1',
        name: 'Summer League',
        gender: 'male',
        position_points: [2, 1, -1, -2],
        ranking_priority: ['games_won'],
        starts_at: '2026-01-01',
        ends_at: null,
        carryover_mode: 'none',
        previous_ladder_id: null,
        competition_type: 'league',
      },
    ];
    (mocks.rankingData as { profileById: Map<string, string> }).profileById = new Map([
      ['member-1', 'Member One'],
      ['partner-1', 'Partner One'],
    ]);
    mocks.singles.league_current_standings = {
      standings: [
        {
          position: 1,
          player_one_id: 'member-1',
          player_two_id: 'partner-1',
          team_name: 'Member One / Partner One',
          matches_played: 2,
          wins: 2,
          points: 4,
          sets_won: 4,
          sets_lost: 0,
          games_won: 24,
          games_lost: 8,
        },
        { player_one_id: 'missing-player', player_two_id: 'partner-1' },
        { player_one_id: 'member-1', player_two_id: 42 },
      ],
    };

    const page = await RankingsPage({
      searchParams: Promise.resolve({ league: ['league-1', 'ignored'] }),
    });
    const { container } = render(page);
    expect(screen.getByRole('heading', { name: 'Summer League standings' })).toBeInTheDocument();
    expect(screen.getByText('Member One / Partner One')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('missing-player')).not.toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('renders the empty league standings state and safely defaults optional row statistics', async () => {
    mocks.singles.profiles = { application_status: 'approved', role: 'member' };
    mocks.rows.social_doubles_ladders = [
      {
        id: 'league-empty',
        name: 'New League',
        gender: 'female',
        position_points: [],
        ranking_priority: [],
        starts_at: '2026-01-01',
        ends_at: null,
        carryover_mode: 'none',
        previous_ladder_id: null,
        competition_type: 'league',
      },
    ];
    (mocks.rankingData as { profileById: Map<string, string> }).profileById = new Map([
      ['player-one', 'Player One'],
      ['player-two', 'Player Two'],
    ]);
    mocks.singles.league_current_standings = { standings: null };

    const emptyPage = await RankingsPage({
      searchParams: Promise.resolve({ league: 'league-empty' }),
    });
    const { container: emptyContainer } = render(emptyPage);
    expect(screen.getByText('No league standings are available yet.')).toBeInTheDocument();
    expect(emptyContainer.querySelectorAll('tbody tr')).toHaveLength(1);
    cleanup();

    mocks.singles.league_current_standings = {
      standings: [
        {
          player_one_id: 'player-one',
          player_two_id: 'player-two',
        },
      ],
    };
    const page = await RankingsPage({ searchParams: Promise.resolve({ league: 'league-empty' }) });
    render(page);
    expect(screen.getAllByText('0–0')).toHaveLength(2);
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });
});
