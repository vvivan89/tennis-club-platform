import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { isValidElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1' } as null | { id: string },
  rows: {} as Record<string, unknown[]>,
  singles: {} as Record<string, unknown>,
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
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: mocks.singles[table] ?? null, error: null }),
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: mocks.rows[table] ?? [], error: null }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/rankings-data', () => ({ getRankingsData: async () => mocks.rankingData }));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/documents-browser', () => ({ DocumentsBrowser: 'documents-browser' }));
vi.mock('@/components/events-browser', () => ({ EventsBrowser: 'events-browser' }));
vi.mock('@/components/rankings-table', () => ({ RankingsTable: 'rankings-table' }));
vi.mock('@/components/season-selector', () => ({ SeasonSelector: 'season-selector' }));
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
  return findElement(node.props.children, type);
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
  if (node.props.href === href) return node as React.ReactElement<Record<string, unknown>>;
  return findHref(node.props.children, href);
}

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.rows = {};
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
afterEach(() => vi.clearAllMocks());

describe('server-rendered data pages', () => {
  it('guards member administration and supplies membership plan defaults and saved settings', async () => {
    mocks.user = null;
    await expect(AdminMembersPage({})).rejects.toThrow('redirect:/login?next=/admin/members');
    mocks.user = { id: 'member-1' };
    mocks.singles.profiles = { role: 'organizer' };
    await expect(AdminMembersPage({})).rejects.toThrow('redirect:/member/dashboard');

    mocks.singles.profiles = { role: 'admin' };
    const defaults = await AdminMembersPage({ searchParams: { tab: 'membership-types' } });
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
    const saved = await AdminMembersPage({ searchParams: { tab: 'membership-types' } });
    expect(findElement(saved, 'membership-types-admin')?.props.initial).toMatchObject({
      single_price_cad: 180,
      family_price_cad: 260,
      family_max_adults: 3,
      family_max_children: 5,
      season_start_month: 5,
      season_end_month: 10,
    });
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

  it('uses legacy family membership and payment fallbacks for dashboard billing details', async () => {
    mocks.singles.profiles = {
      full_name: 'Alex Admin',
      role: 'admin',
      application_status: 'approved',
      show_birthday_emoji: false,
    };
    mocks.singles.memberships = {
      membership_type: 'family_plus',
      payment_status: 'paid',
      created_at: '2026-01-01T00:00:00Z',
    };
    mocks.singles.membership_plan_settings = {
      single_price_cents: 12000,
      family_price_cents: 31000,
      season_start_month: 5,
      season_start_day: 15,
      season_end_month: 10,
      season_end_day: 1,
    };
    mocks.singles.payments = { paid_at: null, created_at: '2026-04-20T00:00:00Z' };

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
    const valid = await RankingsPage({ searchParams: { season: 'all' } });
    expect(findElement(valid, 'season-selector')?.props.season).toBe('all');
    const invalid = await RankingsPage({ searchParams: { season: 'bogus' } });
    expect(findElement(invalid, 'season-selector')?.props.season).not.toBe('bogus');
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
    const page = await MemberResultsPage({ searchParams: { season: 'all' } });
    expect(findElement(page, 'season-selector')?.props.season).toBe('all');
    const { container } = render(page);
    expect(container).toHaveTextContent('Opening Social');
    expect(container).toHaveTextContent('Opponent One');
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
    const article = await PublicationPage({ params: { slug: 'season_opening' } });
    const { container } = render(article);
    expect(screen.getByRole('heading', { name: 'Season Opening' })).toBeInTheDocument();
    expect(container.querySelector('.prose')).toHaveTextContent('Welcome back');

    mocks.rows.news = [];
    await expect(PublicationPage({ params: { slug: 'missing' } })).rejects.toThrow('not-found');
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
});
