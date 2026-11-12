const vapidPublicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || '';

export function supportsChatPush() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function decodeVapidPublicKey(key: string) {
  const padding = '='.repeat((4 - (key.length % 4)) % 4);
  const normalized = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function getChatPushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration?.pushManager.getSubscription() ?? null;
}

export async function removeChatPushSubscriptionForSignOut() {
  if (!supportsChatPush()) return;
  try {
    const subscription = await getChatPushSubscription();
    if (!subscription) return;
    await fetch('/api/member/chat/push-subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      keepalive: true,
    });
    await subscription.unsubscribe();
  } catch (error) {
    console.warn('[Chat push] Could not detach this device during sign out.', error);
  }
}

export async function dispatchChatPush(messageId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/member/chat/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
        keepalive: true,
      });
      const result = (await response.json()) as { failed?: number; duplicate?: boolean };
      if (response.ok && (!result.failed || result.duplicate)) return;
    } catch {
      // Retry a failed request; the server-side job and delivery claims are idempotent.
    }
    if (attempt < 2)
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw new Error('Chat push dispatch did not complete after retries.');
}

export { vapidPublicKey };
