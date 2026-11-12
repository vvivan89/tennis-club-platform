self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.some((client) => client.focused)) return;

      await self.registration.showNotification(payload.title || 'New club chat message', {
        body: payload.body || 'There is a new message in member chat.',
        icon: '/images/tennis-racket-ball.jpg',
        badge: '/images/tennis-racket-ball.jpg',
        tag: payload.tag || 'pctc-chat',
        data: { url: payload.url || '/member/chat' },
        renotify: false,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target;
  try {
    target = new URL(event.notification.data?.url || '/member/chat', self.location.origin);
  } catch {
    target = new URL('/member/chat', self.location.origin);
  }
  if (target.origin !== self.location.origin)
    target = new URL('/member/chat', self.location.origin);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const sameOriginClients = clients.filter((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      const chatClient = sameOriginClients.find(
        (client) => new URL(client.url).pathname === target.pathname,
      );
      if (chatClient) {
        try {
          await chatClient.focus();
          return;
        } catch {
          // If focusing an existing tab fails, open the chat in a new one.
        }
      }

      const existingClient = sameOriginClients[0];
      if (existingClient && typeof existingClient.navigate === 'function') {
        try {
          const navigatedClient = await existingClient.navigate(target.href);
          if (navigatedClient) {
            await navigatedClient.focus();
            return;
          }
        } catch {
          // Some browsers do not allow a service worker to navigate an existing tab.
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
