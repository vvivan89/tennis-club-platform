import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  pathname: '/events',
  authGetUser: vi.fn(),
  profileSingle: vi.fn(),
  rpc: vi.fn(),
  removeChannel: vi.fn(),
  markRead: vi.fn(),
  createClient: vi.fn(),
  subscribe: vi.fn(),
  track: vi.fn(),
  handlers: {} as {
    presence?: () => void;
    profileUpdate?: (payload: {
      new: { chat_notification_preference?: string; application_status?: string };
    }) => void;
  },
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => {
    mocks.createClient();
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: mocks.profileSingle,
    };
    const channel = {
      on: (...args: unknown[]) => {
        const eventName = args[0];
        const handler = args.at(-1);
        if (typeof handler === 'function' && eventName === 'presence')
          mocks.handlers.presence = handler as () => void;
        if (typeof handler === 'function' && eventName === 'postgres_changes')
          mocks.handlers.profileUpdate = handler as (payload: {
            new: { chat_notification_preference?: string; application_status?: string };
          }) => void;
        return channel;
      },
      subscribe: (handler?: (status: string) => void) => {
        if (handler) mocks.subscribe(handler);
        return channel;
      },
      presenceState: () => ({ 'member-2': {} }),
      track: mocks.track,
    };
    return {
      auth: { getUser: mocks.authGetUser },
      from: () => query,
      rpc: mocks.rpc,
      channel: () => channel,
      removeChannel: mocks.removeChannel,
    };
  },
}));
vi.mock('@/lib/member-chat', () => ({
  markMemberChatAsRead: mocks.markRead,
  shouldShowChatNotification: (
    preference: 'all' | 'mentions' | 'none',
    senderId: string,
    currentUserId: string,
    mentions: string[] = [],
  ) =>
    senderId !== currentUserId &&
    (preference === 'all' || (preference === 'mentions' && mentions.includes(currentUserId))),
}));

import { MemberChatNotifications } from '@/components/member-chat-notifications';

function message(
  id: string,
  overrides: Partial<{
    user_id: string;
    body: string | null;
    image_path: string | null;
    mentions: string[];
  }> = {},
) {
  return {
    id,
    user_id: 'member-2',
    body: 'Hello from the club',
    image_path: null,
    ...overrides,
  };
}

function emitMessage(payload?: ReturnType<typeof message>) {
  window.dispatchEvent(
    new CustomEvent('pctc-chat-message-received', {
      detail: payload ? { message: payload } : undefined,
    }),
  );
}

beforeEach(() => {
  mocks.pathname = '/events';
  mocks.authGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'member-1' } } });
  mocks.profileSingle.mockReset().mockResolvedValue({
    data: { application_status: 'approved', chat_notification_preference: 'all' },
    error: null,
  });
  mocks.rpc.mockReset().mockResolvedValue({
    data: [{ id: 'member-2', full_name: 'Taylor Member' }],
    error: null,
  });
  mocks.removeChannel.mockReset();
  mocks.markRead.mockReset().mockResolvedValue(undefined);
  mocks.createClient.mockReset();
  mocks.subscribe.mockReset();
  mocks.track.mockReset().mockResolvedValue({});
  mocks.handlers = {};
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'public-test-key');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('MemberChatNotifications', () => {
  it('skips setup without public configuration and for anonymous or unapproved users', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const unconfigured = render(<MemberChatNotifications />);
    expect(mocks.createClient).not.toHaveBeenCalled();
    unconfigured.unmount();

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
    mocks.authGetUser.mockResolvedValueOnce({ data: { user: null } });
    const anonymous = render(<MemberChatNotifications />);
    await waitFor(() => expect(mocks.authGetUser).toHaveBeenCalledOnce());
    expect(mocks.profileSingle).not.toHaveBeenCalled();
    anonymous.unmount();

    mocks.profileSingle.mockResolvedValueOnce({
      data: { application_status: 'pending', chat_notification_preference: 'all' },
      error: null,
    });
    const unapproved = render(<MemberChatNotifications />);
    await waitFor(() => expect(mocks.profileSingle).toHaveBeenCalledOnce());
    expect(mocks.subscribe).not.toHaveBeenCalled();
    unapproved.unmount();
  });

  it('filters mentions, resolves authors, tracks presence, and marks notifications read', async () => {
    const user = userEvent.setup();
    mocks.profileSingle.mockResolvedValueOnce({
      data: { application_status: 'approved', chat_notification_preference: 'mentions' },
      error: null,
    });
    const view = render(<MemberChatNotifications />);
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
    emitMessage(message('not-mentioned'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    emitMessage(message('mentioned', { mentions: ['member-1'] }));
    expect(await screen.findByText('New chat message · Taylor Member')).toBeInTheDocument();
    expect(screen.getByText('Hello from the club')).toBeInTheDocument();

    emitMessage(message('mentioned', { body: 'Duplicate body', mentions: ['member-1'] }));
    expect(screen.queryByText('Duplicate body')).not.toBeInTheDocument();
    emitMessage(message('self', { user_id: 'member-1' }));

    const presenceEvents: CustomEvent[] = [];
    const onPresence = (event: Event) => presenceEvents.push(event as CustomEvent);
    window.addEventListener('pctc-chat-presence-updated', onPresence);
    window.dispatchEvent(new Event('pctc-chat-presence-request'));
    mocks.handlers.presence?.();
    expect(presenceEvents.at(-1)?.detail).toEqual({ userIds: ['member-2'] });
    const onSubscribed = mocks.subscribe.mock.calls[0][0] as (status: string) => Promise<void>;
    await act(async () => onSubscribed('SUBSCRIBED'));
    expect(mocks.track).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'member-1', connected_at: expect.any(String) }),
    );
    window.removeEventListener('pctc-chat-presence-updated', onPresence);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.markRead.mockRejectedValueOnce(new Error('read failed'));
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(mocks.markRead).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
  });

  it('suppresses chat-page messages and reacts to preference and membership updates', async () => {
    mocks.pathname = '/member/chat';
    const view = render(<MemberChatNotifications />);
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
    emitMessage(message('chat-page-message'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    mocks.pathname = '/events';
    view.rerender(<MemberChatNotifications />);
    emitMessage(message('chat-page-message'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    emitMessage(message('visible-message', { body: null, image_path: 'photo.png' }));
    expect(await screen.findByText('Sent an image')).toBeInTheDocument();

    window.dispatchEvent(
      new CustomEvent('pctc-chat-notification-preference-updated', {
        detail: { preference: 'none' },
      }),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    emitMessage(message('preference-hidden'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    window.dispatchEvent(
      new CustomEvent('pctc-chat-notification-preference-updated', {
        detail: { preference: 'all' },
      }),
    );
    emitMessage(message('membership-toast'));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    act(() => mocks.handlers.profileUpdate?.({ new: { application_status: 'suspended' } }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    view.unmount();
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
  });
});
