import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { application_status: string },
  unreadCount: 0,
  rpcError: null as null | { message: string },
  callbacks: [] as Array<{ event: string; callback: (payload?: unknown) => void }>,
  removeChannel: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/member/results/detail' }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : null,
          error: null,
        }),
      };
      return query;
    },
    rpc: async () => ({ data: mocks.unreadCount, error: mocks.rpcError }),
    channel: () => {
      const channel: Record<string, unknown> = {};
      channel.on = (
        _type: string,
        filter: { event?: string },
        callback: (payload?: unknown) => void,
      ) => {
        mocks.callbacks.push({ event: filter.event ?? '*', callback });
        return channel;
      };
      channel.subscribe = (callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return channel;
      };
      return channel;
    },
    removeChannel: mocks.removeChannel,
  }),
}));

import { MemberNav } from '@/components/member-nav';

beforeEach(() => {
  mocks.user = null;
  mocks.profile = null;
  mocks.unreadCount = 0;
  mocks.rpcError = null;
  mocks.callbacks = [];
  mocks.removeChannel.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MemberNav', () => {
  it('does not expose member-only links when signed out or unapproved', async () => {
    const { rerender } = render(<MemberNav />);
    expect(screen.getByRole('link', { name: 'Results' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();

    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'pending' };
    rerender(<MemberNav />);
    await waitFor(() => expect(mocks.callbacks).toHaveLength(0));
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();
  });

  it('shows unread counts, caps the badge, and refreshes from chat events', async () => {
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'approved' };
    mocks.unreadCount = 120;
    const { unmount } = render(<MemberNav />);

    expect(await screen.findByLabelText('120 unread messages')).toBeInTheDocument();
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(mocks.callbacks.some(({ event }) => event === '*')).toBe(true);

    mocks.unreadCount = 2;
    window.dispatchEvent(new Event('pctc-chat-message-received'));
    expect(await screen.findByLabelText('2 unread messages')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Chat/ })).toHaveAttribute('href', '/member/chat');

    unmount();
    expect(mocks.removeChannel).toHaveBeenCalled();
  });

  it('does not render a badge on the active chat route and ignores RPC errors', async () => {
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'approved' };
    mocks.unreadCount = 4;
    mocks.rpcError = { message: 'unavailable' };
    const { rerender } = render(<MemberNav />);
    expect(await screen.findByRole('link', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument();

    mocks.rpcError = null;
    mocks.unreadCount = 0;
    rerender(<MemberNav />);
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument());
  });

  it('refreshes the unpaid membership badge when a confirmed family payment arrives', async () => {
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'approved' };
    let familyPaid = false;
    const membershipResponse = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        settings: {
          season_start_month: 4,
          season_start_day: 1,
          season_end_month: 9,
          season_end_day: 30,
        },
        families: familyPaid
          ? [
              {
                membership: {
                  user_id: 'member-1',
                  status: 'confirmed',
                  joined_at: '2026-10-01',
                  created_at: '2026-10-01',
                },
                family: { paid_at: '2026-10-02T12:00:00Z', payment_id: 'family-payment' },
              },
            ]
          : [],
        memberships: [],
        payments: [],
      }),
    }));
    vi.stubGlobal('fetch', membershipResponse);
    const { unmount } = render(<MemberNav />);

    expect(
      await screen.findByLabelText('Membership payment is unpaid for the current season'),
    ).toBeInTheDocument();
    familyPaid = true;
    window.dispatchEvent(new Event('focus'));
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Membership payment is unpaid for the current season'),
      ).not.toBeInTheDocument(),
    );

    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(membershipResponse.mock.calls.length).toBeGreaterThan(1));
    unmount();
  });

  it('rechecks current-season individual and next-season family payment states', async () => {
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'approved' };
    const now = new Date();
    const startThisYear = new Date(now.getFullYear(), 3, 1);
    const endThisYear = new Date(now.getFullYear(), 8, 30, 23, 59, 59, 999);
    const year =
      now < startThisYear
        ? now.getFullYear()
        : now > endThisYear
          ? now.getFullYear() + 1
          : now.getFullYear();
    const makeResponse = (payload: unknown) => ({ ok: true, json: async () => payload });
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          memberships: [
            {
              id: 'membership-current',
              starts_on: `${year}-04-01`,
              ends_on: `${year}-09-30`,
              payment_status: 'unpaid',
            },
          ],
          payments: [],
          families: [],
        }) as Response,
      )
      .mockResolvedValueOnce(
        makeResponse({
          memberships: [
            {
              id: 'membership-current',
              starts_on: `${year}-04-01`,
              ends_on: `${year}-09-30`,
              payment_status: 'unpaid',
            },
          ],
          payments: [],
          families: [],
        }) as Response,
      )
      .mockResolvedValueOnce(
        makeResponse({
          memberships: [
            {
              id: 'membership-current',
              starts_on: `${year}-04-01`,
              ends_on: `${year}-09-30`,
              payment_status: 'paid',
            },
          ],
          payments: [],
          families: [],
        }) as Response,
      )
      .mockResolvedValueOnce(
        makeResponse({
          memberships: [],
          payments: [],
          families: [
            {
              membership: {
                user_id: 'member-1',
                status: 'removed_next_season',
                joined_at: null,
                created_at: '2026-01-01',
              },
              family: { paid_at: null, payment_id: 'family-payment' },
            },
          ],
        }) as Response,
      );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<MemberNav />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      await screen.findByLabelText('Membership payment is unpaid for the current season'),
    ).toBeInTheDocument();

    window.dispatchEvent(new Event('focus'));
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Membership payment is unpaid for the current season'),
      ).not.toBeInTheDocument(),
    );

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(
      screen.queryByLabelText('Membership payment is unpaid for the current season'),
    ).not.toBeInTheDocument();
    unmount();
  });

  it('keeps the last badge state when the membership status request fails', async () => {
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'approved' };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MemberNav />);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(
      screen.queryByLabelText('Membership payment is unpaid for the current season'),
    ).not.toBeInTheDocument();
  });
});
