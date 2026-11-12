import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMocks = vi.hoisted(() => ({
  supported: true,
  subscription: null as null | {
    endpoint: string;
    toJSON: () => unknown;
    unsubscribe: ReturnType<typeof vi.fn>;
  },
  getSubscription: vi.fn(),
}));

vi.mock('@/lib/chat-push-client', () => ({
  supportsChatPush: () => pushMocks.supported,
  getChatPushSubscription: () => pushMocks.getSubscription(),
  decodeVapidPublicKey: () => new Uint8Array([1]),
  vapidPublicKey: 'public-vapid-key',
}));

import { MemberChatPushSettings } from '@/components/member-chat-push-settings';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MemberChatPushSettings', () => {
  it('explains denied browser permission and does not offer another prompt', async () => {
    class DeniedNotification {
      static permission = 'denied';
      static requestPermission = vi.fn();
    }
    vi.stubGlobal('Notification', DeniedNotification);
    vi.stubGlobal('PushManager', class PushManager {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn(async () => ({
          pushManager: { getSubscription: vi.fn(async () => null) },
        })),
      },
    });

    render(<MemberChatPushSettings />);
    expect(
      await screen.findByText(/Notifications are blocked by your browser/),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(DeniedNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports unsupported browsers without requesting permission', async () => {
    pushMocks.supported = false;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal('PushManager', undefined);

    render(<MemberChatPushSettings />);
    await waitFor(() =>
      expect(
        screen.getByText(/This browser does not support push notifications/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('asks on click, saves this device subscription, and deletes it when disabled', async () => {
    class AllowedNotification {
      static permission: string = 'default';
      static requestPermission = vi.fn(async () => {
        AllowedNotification.permission = 'granted';
        return 'granted';
      });
    }
    const subscription = {
      endpoint: 'https://push.example/current-device',
      toJSON: () => ({
        endpoint: 'https://push.example/current-device',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      }),
      unsubscribe: vi.fn(async () => true),
    };
    pushMocks.supported = true;
    pushMocks.subscription = null;
    pushMocks.getSubscription.mockImplementation(() => pushMocks.subscription);
    vi.stubGlobal('Notification', AllowedNotification);
    vi.stubGlobal('PushManager', class PushManager {});
    const pushManager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => subscription),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: vi.fn(async () => ({ pushManager })) },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ enabled: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    const view = render(<MemberChatPushSettings />);
    const enable = await screen.findByRole('switch', { name: 'Enable on this device' });
    await user.click(enable);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/member/chat/push-subscriptions',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(AllowedNotification.requestPermission).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1]),
    });

    pushMocks.subscription = subscription;
    await user.click(await screen.findByRole('switch', { name: 'Disable on this device' }));
    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/member/chat/push-subscriptions',
      expect.objectContaining({ method: 'DELETE' }),
    );
    view.unmount();
  });
});
