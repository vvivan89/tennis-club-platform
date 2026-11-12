import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const serviceWorkerSource = readFileSync('public/sw.js', 'utf8');

function loadServiceWorker(clients: Array<Record<string, unknown>>) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const self = {
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) =>
      handlers.set(type, handler),
    location: { origin: 'https://club.example' },
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      matchAll: vi.fn(async () => clients),
      claim: vi.fn(async () => undefined),
      openWindow: vi.fn(async (url: string) => ({ url })),
    },
    registration: { showNotification: vi.fn() },
  };
  runInNewContext(serviceWorkerSource, { self, URL });
  return { handlers, self };
}

async function clickNotification(handler: (event: Record<string, unknown>) => void) {
  let completion: Promise<void> | undefined;
  const close = vi.fn();
  handler({
    notification: { close, data: { url: '/member/chat' } },
    waitUntil: (promise: Promise<void>) => {
      completion = promise;
    },
  });
  await completion;
  return close;
}

describe('chat push service worker', () => {
  it('activates the updated worker and claims existing pages', async () => {
    const { handlers, self } = loadServiceWorker([]);
    let installComplete: Promise<void> | undefined;
    const installHandler = handlers.get('install')!;
    installHandler({ waitUntil: (promise: Promise<void>) => (installComplete = promise) });
    await installComplete;

    const activateHandler = handlers.get('activate')!;
    let activationComplete: Promise<void> | undefined;
    activateHandler({ waitUntil: (promise: Promise<void>) => (activationComplete = promise) });
    await activationComplete;

    expect(self.skipWaiting).toHaveBeenCalledOnce();
    expect(self.clients.claim).toHaveBeenCalledOnce();
  });

  it('opens the chat when an existing tab cannot be navigated', async () => {
    const profileTab = {
      url: 'https://club.example/member/profile',
      focus: vi.fn(async () => undefined),
    };
    const { handlers, self } = loadServiceWorker([profileTab]);

    await clickNotification(handlers.get('notificationclick')!);

    expect(self.clients.openWindow).toHaveBeenCalledWith('https://club.example/member/chat');
  });

  it('focuses an existing chat tab without opening a duplicate', async () => {
    const chatTab = {
      url: 'https://club.example/member/chat',
      focus: vi.fn(async () => undefined),
    };
    const { handlers, self } = loadServiceWorker([chatTab]);

    await clickNotification(handlers.get('notificationclick')!);

    expect(chatTab.focus).toHaveBeenCalledOnce();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });
});
