import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  rows: {} as Record<string, unknown[]>,
  singles: {} as Record<string, unknown>,
  contacts: [] as unknown[],
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  rpcs: [] as string[],
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: async (name: string) => {
      mocks.rpcs.push(name);
      return { data: name === 'event_organizer_contacts' ? mocks.contacts : [], error: null };
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        or: () => query,
        neq: () => query,
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
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/event-detail-client', () => ({ EventDetailClient: () => null }));
vi.mock('@/components/event-edit-management', () => ({ EventEditManagement: () => null }));

import EventDetailsPage from '@/app/events/[slug]/page';

const publishedEvent = {
  id: 'event-1',
  slug: 'spring-open',
  title: 'Spring Open',
  status: 'published',
  created_by: 'organizer-1',
  organizer_id: 'organizer-1',
  starts_at: '2027-06-01T12:00:00Z',
  ends_at: '2027-06-01T14:00:00Z',
  registration_opens_at: '2027-01-01T00:00:00Z',
  registration_closes_at: null,
  capacity: 12,
  price_cents: 0,
  members_only: false,
  event_type: 'social',
  location: 'Courts',
  notes: '',
};
function setup(user: null | { id: string }, event = publishedEvent) {
  mocks.user = user;
  mocks.singles = {
    events: event,
    club_settings: {
      club_name: 'Club',
      short_name: 'C',
      social_links: [],
      location_query: 'Club courts',
    },
    registrations: null,
    profiles: user ? { role: 'member', application_status: 'approved' } : null,
    event_public_counts: { confirmed_count: 2 },
  };
  mocks.rows = {
    memberships: [],
    payments: [],
    membership_family_members: [],
    event_roster: [],
    event_court_assignments: [],
    event_scoreboard: [],
  };
  mocks.contacts = [];
  mocks.rpcs = [];
}

afterEach(() => {
  vi.clearAllMocks();
});
beforeEach(() => setup(null));

describe('EventDetailsPage', () => {
  it('renders published events for anonymous users without requesting private contacts', async () => {
    const page = await EventDetailsPage({ params: { slug: 'spring-open' } });
    render(page);
    expect(screen.getByRole('heading', { name: 'Spring Open' })).toBeInTheDocument();
    expect(mocks.rpcs).not.toContain('event_organizer_contacts');
    expect(screen.queryByText('Event organizer')).not.toBeInTheDocument();
  });

  it('shows organizer contacts for an approved member with a historically paid membership', async () => {
    setup({ id: 'member-1' });
    mocks.rows.memberships = [
      { id: 'membership-1', payment_status: 'paid', status: 'expired', ends_on: '2020-09-30' },
    ];
    mocks.contacts = [
      {
        organizer_id: 'organizer-1',
        organizer_name: 'Jordan Organizer',
        position: 'Tournament director',
        emails: ['jordan@example.com'],
        phones: ['604-555-0111'],
      },
    ];
    const page = await EventDetailsPage({ params: { slug: 'spring-open' } });
    render(page);
    expect(screen.getByText('Jordan Organizer')).toBeInTheDocument();
    expect(screen.getByText('Tournament director')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'jordan@example.com' })).toHaveAttribute(
      'href',
      'mailto:jordan@example.com',
    );
    expect(mocks.rpcs).toContain('event_organizer_contacts');
  });

  it('does not reveal organizer data to a never-paid approved member', async () => {
    setup({ id: 'member-1' });
    mocks.singles.profiles = { role: 'member', application_status: 'approved' };
    mocks.contacts = [];
    const page = await EventDetailsPage({ params: { slug: 'spring-open' } });
    render(page);
    expect(screen.queryByText('Event organizer')).not.toBeInTheDocument();
  });

  it('uses not-found behavior for missing events and private drafts viewed by non-managers', async () => {
    mocks.singles.events = null;
    await expect(EventDetailsPage({ params: { slug: 'missing' } })).rejects.toThrow('not-found');
    setup({ id: 'member-1' }, { ...publishedEvent, status: 'draft', created_by: 'another-user' });
    await expect(EventDetailsPage({ params: { slug: 'spring-open' } })).rejects.toThrow(
      'not-found',
    );
  });
});
