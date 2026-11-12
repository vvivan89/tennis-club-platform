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
  const target = new URL(event.notification.data?.url || '/member/chat', self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client && new URL(client.url).pathname !== target.pathname) {
            await client.navigate(target.href);
          }
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
