import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1', email: 'member@example.com' } as null | { id: string; email: string },
  profile: {
    id: 'member-1',
    full_name: 'Member One',
    email: 'member@example.com',
    application_status: 'approved',
  },
  fetch: vi.fn(),
  posts: [] as Array<{ url: string; body: string }>,
  responseData: {} as unknown,
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data:
            table === 'profiles'
              ? mocks.profile
              : { club_name: 'Club', short_name: 'C', social_links: [] },
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/member-nav', () => ({ MemberNav: () => null }));

import MembershipPortal from '@/app/member/membership/page';

const state = {
  families: [
    {
      membership: {
        id: 'family-member-1',
        family_id: 'family-1',
        user_id: 'member-1',
        status: 'confirmed',
        joined_at: '2026-01-01',
        created_at: '2026-01-01',
      },
      family: {
        id: 'family-1',
        season_year: 2026,
        paid_at: '2026-01-10',
        paid_by: 'member-1',
        payment_id: 'payment-1',
      },
      members: [
        {
          id: 'family-member-1',
          user_id: 'member-1',
          status: 'confirmed',
          profiles: { full_name: 'Member One', email: 'member@example.com' },
        },
        {
          id: 'family-member-2',
          user_id: 'relative-1',
          status: 'confirmed',
          profiles: { full_name: 'Relative One', email: 'relative@example.com' },
        },
      ],
    },
  ],
  people: [],
  settings: {
    single_price_cents: 15000,
    family_price_cents: 22000,
    family_max_adults: 2,
    family_max_children: 4,
    season_start_month: 4,
    season_start_day: 1,
    season_end_month: 9,
    season_end_day: 30,
  },
  memberships: [
    {
      id: 'membership-1',
      user_id: 'member-1',
      membership_type: 'family',
      status: 'active',
      payment_status: 'paid',
      starts_on: '2026-04-01',
      ends_on: '2026-09-30',
      created_at: '2026-01-01',
    },
  ],
  payments: [
    {
      id: 'payment-1',
      membership_id: 'membership-1',
      amount_cents: 22000,
      status: 'recorded_manually',
      provider: 'etransfer',
      paid_at: '2026-01-10',
      created_at: '2026-01-10',
      notes: 'Family plan paid',
    },
  ],
};

beforeEach(() => {
  mocks.user = { id: 'member-1', email: 'member@example.com' };
  mocks.profile = {
    id: 'member-1',
    full_name: 'Member One',
    email: 'member@example.com',
    application_status: 'approved',
  };
  mocks.posts = [];
  mocks.responseData = state;
  mocks.fetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      mocks.posts.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ success: true, effectiveNextSeason: true }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(mocks.responseData), { status: 200 });
  });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Member membership portal', () => {
  it('renders paid family status, member list, season fee, and payment history', async () => {
    render(<MembershipPortal />);
    expect(await screen.findByRole('heading', { name: 'Family membership' })).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Relative One')).toBeInTheDocument();
    expect(screen.getAllByText('$220.00')).toHaveLength(3);
    expect(screen.getByText('Family plan paid')).toBeInTheDocument();
    expect(screen.getByText('recorded manually')).toBeInTheDocument();
  });

  it('posts a family leave action and distinguishes next-season removal for paid plans', async () => {
    const user = userEvent.setup();
    render(<MembershipPortal />);
    await user.click(await screen.findByRole('button', { name: 'Leave family' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(1));
    expect(JSON.parse(mocks.posts[0].body)).toEqual({ action: 'remove' });
    expect(await screen.findByRole('status')).toHaveTextContent('scheduled for the next season');
  });

  it('handles failed family actions without claiming success', async () => {
    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ error: 'denied' }), { status: 403 })
        : new Response(JSON.stringify(state), { status: 200 }),
    );
    const user = userEvent.setup();
    render(<MembershipPortal />);
    await user.click(await screen.findByRole('button', { name: 'Leave family' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not update family membership',
    );
  });

  it('accepts an incoming invitation and submits its invitation ID', async () => {
    const pendingFamily = {
      ...state.families[0],
      membership: { ...state.families[0].membership, status: 'pending' },
      family: { ...state.families[0].family, paid_at: null, payment_id: null },
    };
    mocks.responseData = { ...state, families: [pendingFamily], memberships: [], payments: [] };
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        mocks.posts.push({ url, body: String(init.body) });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify(mocks.responseData), { status: 200 });
    });
    const user = userEvent.setup();
    render(<MembershipPortal />);
    expect(await screen.findByText('Family invitation pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(1));
    expect(JSON.parse(mocks.posts[0].body)).toEqual({
      action: 'confirm',
      invitationId: 'family-member-1',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
  });

  it('invites an available approved member when the user has no current family', async () => {
    mocks.responseData = {
      ...state,
      families: [],
      people: [
        { id: 'member-1', full_name: 'Member One', email: 'member@example.com', available: true },
        {
          id: 'invite-1',
          full_name: 'Taylor Member',
          email: 'taylor@example.com',
          available: true,
        },
      ],
      memberships: [],
      payments: [],
    };
    const user = userEvent.setup();
    render(<MembershipPortal />);
    const select = await screen.findByPlaceholderText('Search by player name…');
    await user.click(select);
    await user.type(select, 'Taylor');
    await user.click(screen.getByRole('option', { name: /Taylor Member/ }));
    await user.click(screen.getByRole('button', { name: 'Send family invitation' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(1));
    expect(JSON.parse(mocks.posts[0].body)).toEqual({ action: 'invite', userId: 'invite-1' });
  });

  it('reports membership API load failures instead of rendering stale payment data', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'service unavailable' }), { status: 503 }),
    );
    render(<MembershipPortal />);
    expect(
      await screen.findByText('Unable to load membership information. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No membership record')).toBeInTheDocument();
    expect(screen.getByText('No payment recorded')).toBeInTheDocument();
  });
});
