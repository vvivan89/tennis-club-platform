import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function getCurrentSeasonYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 3, 1); // April 1
  const end = new Date(now.getFullYear(), 8, 30); // Sept 30
  if (now < start) return now.getFullYear();
  if (now > end) return now.getFullYear() + 1;
  return now.getFullYear();
}

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1', email: 'member@example.com' } as null | { id: string; email: string },
  profile: {
    id: 'member-1',
    full_name: 'Member One',
    email: 'member@example.com',
    application_status: 'approved',
  },
  methodSettings: { interac_enabled: false, interac_recipient_email: '', interac_instructions: '' },
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
              : table === 'payment_method_settings'
                ? mocks.methodSettings
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
        season_year: getCurrentSeasonYear(),
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
      purpose: 'membership',
      business_record_id: 'membership-1',
      amount_minor: 22000,
      currency: 'CAD',
      status: 'succeeded',
      created_at: '2026-01-10',
      succeeded_at: '2026-01-10',
      refunded_amount_minor: 0,
    },
  ],
  currentWaiver: {
    version: 1,
    title: 'Membership Waiver',
    body_html: '<p>I accept the waiver</p>',
  },
};

beforeEach(() => {
  mocks.user = { id: 'member-1', email: 'member@example.com' };
  mocks.profile = {
    id: 'member-1',
    full_name: 'Member One',
    email: 'member@example.com',
    application_status: 'approved',
  };
  mocks.methodSettings = {
    interac_enabled: false,
    interac_recipient_email: '',
    interac_instructions: '',
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
  it('does not request member family data when no user session is present', async () => {
    mocks.user = null;
    render(<MembershipPortal />);
    expect(await screen.findByText('No membership record')).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: 'Your membership waiver' }),
    ).not.toBeInTheDocument();
  });

  it('renders paid family status, member list, season fee, and payment history', async () => {
    render(<MembershipPortal />);
    expect(await screen.findByRole('heading', { name: 'Family membership' })).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Relative One')).toBeInTheDocument();
    expect(screen.getAllByText('$220.00')).toHaveLength(3);
    expect(screen.getByText('Membership payment')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it.each([
    ['2026-05-02', '2026-05-03', 'May 2nd, 2026 – May 3rd, 2026'],
    ['2026-05-03', '2026-05-11', 'May 3rd, 2026 – May 11th, 2026'],
    ['2026-05-12', '2026-05-21', 'May 12th, 2026 – May 21st, 2026'],
  ])(
    'formats membership dates with ordinal suffixes: %s to %s',
    async (startsOn, endsOn, label) => {
      mocks.responseData = {
        ...state,
        families: [],
        memberships: [
          {
            ...state.memberships[0],
            membership_type: 'single',
            status: 'pending',
            payment_status: 'unpaid',
            starts_on: startsOn,
            ends_on: endsOn,
            waiver_version: '1',
            waiver_accepted_at: '2026-01-02T12:00:00Z',
          },
        ],
        payments: [],
      };
      render(<MembershipPortal />);
      expect(await screen.findByText(label)).toBeInTheDocument();
    },
  );

  it('posts a family leave action and distinguishes next-season removal for paid plans', async () => {
    const user = userEvent.setup();
    render(<MembershipPortal />);
    await user.click(await screen.findByRole('button', { name: 'Leave family' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(1));
    expect(JSON.parse(mocks.posts[0].body)).toEqual({ action: 'remove', familyId: 'family-1' });
    expect(await screen.findByRole('status')).toHaveTextContent('scheduled to leave the family');
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
    expect(await screen.findByRole('alert')).toHaveTextContent('denied');
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

    // Accept the waiver separately from accepting the family invitation.
    const waiverButton = screen.getByRole('button', {
      name: /accept the current membership waiver/i,
    });
    await user.click(waiverButton);

    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(2));
    const postBody = JSON.parse(mocks.posts[1].body);
    expect(postBody).toMatchObject({
      action: 'confirm',
      invitationId: 'family-member-1',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('accepted the family invitation');
  });

  it('keeps family payment unavailable while an invitation is still pending', async () => {
    mocks.responseData = {
      ...state,
      families: [
        {
          ...state.families[0],
          membership: { ...state.families[0].membership, status: 'pending' },
          family: { ...state.families[0].family, paid_at: null, payment_id: null },
          members: [state.families[0].members[0]],
        },
      ],
      memberships: [
        {
          ...state.memberships[0],
          membership_type: 'single',
          payment_status: 'unpaid',
          starts_on: `${getCurrentSeasonYear()}-04-01`,
          ends_on: `${getCurrentSeasonYear()}-09-30`,
          waiver_version: '1',
          waiver_accepted_at: '2026-01-02T12:00:00Z',
        },
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(<MembershipPortal />);
    expect(await screen.findByText('Family invitation pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(1));
    expect(JSON.parse(mocks.posts[0].body)).toMatchObject({
      membershipKind: 'individual',
      businessRecordId: 'membership-1',
    });
  });

  it('shows a confirmed family as pending until every member accepts the waiver', async () => {
    mocks.responseData = {
      ...state,
      families: [
        {
          ...state.families[0],
          membership: {
            ...state.families[0].membership,
            status: 'confirmed',
            waiver_accepted_at: null,
          },
          family: { ...state.families[0].family, paid_at: null, payment_id: null },
          members: state.families[0].members.map((member, index) => ({
            ...member,
            waiver_accepted_at: index === 0 ? '2026-01-02T12:00:00Z' : null,
          })),
        },
      ],
      memberships: [],
      payments: [],
    };
    render(<MembershipPortal />);
    expect(await screen.findByText('Family membership · pending')).toBeInTheDocument();
    expect(
      screen.getByText(/each member must individually accept the current waiver before payment/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled();
  });

  it('shows a paid family departure as effective next season', async () => {
    mocks.responseData = {
      ...state,
      families: [
        {
          ...state.families[0],
          membership: { ...state.families[0].membership, status: 'removed_next_season' },
          family: { ...state.families[0].family, paid_at: '2026-04-01' },
        },
      ],
      memberships: [],
      payments: [],
    };
    render(<MembershipPortal />);
    expect(await screen.findByText('Family membership · leaving next season')).toBeInTheDocument();
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

  it('requests an Interac membership payment and displays its instructions and amount', async () => {
    const seasonYear = getCurrentSeasonYear();
    mocks.methodSettings = {
      interac_enabled: true,
      interac_recipient_email: 'payments@example.com',
      interac_instructions: 'Include your membership number in the note.',
    };
    mocks.responseData = {
      ...state,
      families: [],
      memberships: [
        {
          ...state.memberships[0],
          membership_type: 'single',
          payment_status: 'unpaid',
          starts_on: `${seasonYear}-04-01`,
          ends_on: `${seasonYear}-09-30`,
          waiver_version: '1',
          waiver_accepted_at: '2026-01-02T12:00:00Z',
        },
      ],
      payments: [],
    };
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/payments/checkout' && init?.method === 'POST') {
        mocks.posts.push({ url, body: String(init.body) });
        return new Response(
          JSON.stringify({
            amountMinor: 15000,
            recipientEmail: 'payments@example.com',
            paymentId: 'interac-membership-1',
            instructions: 'Include your membership number in the note.',
            message: 'Payment request pending confirmation.',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(mocks.responseData), { status: 200 });
    });
    const user = userEvent.setup();
    render(<MembershipPortal />);
    await user.click(await screen.findByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('menuitem', { name: /Individual by Interac · \$150\.00/ }));

    expect(await screen.findByText('Interac e-Transfer instructions')).toBeInTheDocument();
    expect(screen.getByText('Include your membership number in the note.')).toBeInTheDocument();
    expect(screen.getByText('payments@example.com')).toBeInTheDocument();
    expect(await screen.findByText(/Interac payment request submitted/)).toBeInTheDocument();
    expect(JSON.parse(mocks.posts[0].body)).toMatchObject({
      purpose: 'membership',
      provider: 'interac',
      membershipKind: 'individual',
      businessRecordId: 'membership-1',
      waiverAccepted: true,
      waiverVersion: 1,
    });
  });

  it('shows saved Interac instructions for an already pending individual payment', async () => {
    const seasonYear = getCurrentSeasonYear();
    mocks.methodSettings = {
      interac_enabled: true,
      interac_recipient_email: 'payments@example.com',
      interac_instructions: 'Use your member name.',
    };
    mocks.responseData = {
      ...state,
      families: [],
      memberships: [
        {
          ...state.memberships[0],
          membership_type: 'single',
          payment_status: 'unpaid',
          starts_on: `${seasonYear}-04-01`,
          ends_on: `${seasonYear}-09-30`,
          waiver_version: '1',
          waiver_accepted_at: '2026-01-02T12:00:00Z',
        },
      ],
      payments: [
        {
          ...state.payments[0],
          id: 'interac-pending',
          business_record_id: 'membership-1',
          provider: 'interac',
          status: 'pending',
          amount_minor: 15000,
          instructions: 'Use your member name.',
        },
      ],
    };
    const user = userEvent.setup();
    render(<MembershipPortal />);
    expect(
      await screen.findByText('Interac payment pending club confirmation'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Interac membership payment has been requested/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await user.click(
      screen.getByRole('menuitem', { name: /View Interac instructions · \$150\.00/ }),
    );
    expect(await screen.findByText('Use your member name.')).toBeInTheDocument();
    expect(mocks.posts).toHaveLength(0);
  });

  it('accepts the waiver independently and confirms the saved date through a toast', async () => {
    mocks.responseData = {
      ...state,
      families: [],
      memberships: [
        {
          ...state.memberships[0],
          membership_type: 'single',
          payment_status: 'unpaid',
          waiver_version: null,
          waiver_accepted_at: null,
        },
      ],
      payments: [],
    };
    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        mocks.posts.push({ url: String(_url), body: String(init.body) });
        return new Response(JSON.stringify({ success: true, acceptedAt: '2026-01-02T12:00:00Z' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(mocks.responseData), { status: 200 });
    });
    const user = userEvent.setup();
    render(<MembershipPortal />);
    await user.click(
      await screen.findByRole('button', {
        name: /I have read and accept the current membership waiver/i,
      }),
    );
    expect(await screen.findByText(/Your waiver acceptance was saved on/)).toBeInTheDocument();
    expect(mocks.posts).toHaveLength(1);
    expect(JSON.parse(mocks.posts[0].body)).toMatchObject({
      action: 'accept_waiver',
      waiverAccepted: true,
      waiverVersion: 1,
    });
    expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument();
  });

  it('requests a family Interac payment only after both confirmed family members accept their waivers', async () => {
    mocks.methodSettings = {
      interac_enabled: true,
      interac_recipient_email: 'payments@example.com',
      interac_instructions: 'Include your family number in the note.',
    };
    mocks.responseData = {
      ...state,
      families: [
        {
          ...state.families[0],
          membership: {
            ...state.families[0].membership,
            status: 'confirmed',
            waiver_version: '1',
            waiver_accepted_at: '2026-01-02T12:00:00Z',
          },
          family: { ...state.families[0].family, paid_at: null, payment_id: null },
          members: state.families[0].members.map((member) => ({
            ...member,
            waiver_version: '1',
            waiver_accepted_at: '2026-01-02T12:00:00Z',
          })),
        },
      ],
      memberships: [],
      payments: [],
    };
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/payments/checkout' && init?.method === 'POST') {
        mocks.posts.push({ url, body: String(init.body) });
        return new Response(
          JSON.stringify({
            amountMinor: 22000,
            recipientEmail: 'payments@example.com',
            paymentId: 'family-interac-1',
            instructions: 'Include your family number in the note.',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(mocks.responseData), { status: 200 });
    });
    const user = userEvent.setup();
    render(<MembershipPortal />);
    await user.click(await screen.findByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('menuitem', { name: /Family by Interac · \$220\.00/ }));
    expect(await screen.findByText('Interac e-Transfer instructions')).toBeInTheDocument();
    expect(screen.getAllByText('$220.00').length).toBeGreaterThan(1);
    expect(JSON.parse(mocks.posts[0].body)).toMatchObject({
      purpose: 'membership',
      provider: 'interac',
      membershipKind: 'family',
      businessRecordId: 'family-1',
    });
  });
});
