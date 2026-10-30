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

afterEach(() => cleanup());

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
    expect(mocks.callbacks.map(({ event }) => event)).toEqual(['INSERT', 'UPDATE', 'DELETE', '*']);

    mocks.unreadCount = 2;
    window.dispatchEvent(new Event('pctc-chat-message-received'));
    expect(await screen.findByLabelText('2 unread messages')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Chat/ })).toHaveAttribute('href', '/member/chat');

    unmount();
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
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
});
