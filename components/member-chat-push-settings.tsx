'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TennisLoader } from '@/components/tennis-loader';
import {
  decodeVapidPublicKey,
  getChatPushSubscription,
  supportsChatPush,
  vapidPublicKey,
} from '@/lib/chat-push-client';

type PushStatus = 'loading' | 'unsupported' | 'enabled' | 'disabled' | 'denied' | 'failed';

export function MemberChatPushSettings() {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!supportsChatPush()) {
        if (active) setStatus('unsupported');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;
        if (Notification.permission === 'denied') {
          if (subscription) {
            await fetch('/api/member/chat/push-subscriptions', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: subscription.endpoint }),
            });
            await subscription.unsubscribe();
          }
          setStatus('denied');
          return;
        }
        if (!subscription) {
          setStatus('disabled');
          return;
        }
        const response = await fetch('/api/member/chat/push-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', endpoint: subscription.endpoint }),
          cache: 'no-store',
        });
        const result = (await response.json()) as { enabled?: boolean };
        if (active) setStatus(response.ok && result.enabled ? 'enabled' : 'disabled');
      } catch {
        if (active) setStatus('failed');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function togglePush() {
    if (busy || status === 'unsupported' || status === 'denied') return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      let subscription = await getChatPushSubscription();
      if (status === 'enabled' && subscription) {
        const response = await fetch('/api/member/chat/push-subscriptions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error('Could not disable notifications on this device.');
        await subscription.unsubscribe();
        setStatus('disabled');
        setNotice('Push notifications are disabled on this device.');
        return;
      }

      if (!vapidPublicKey) throw new Error('Push notifications are not configured yet.');
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'disabled');
        setNotice('Allow notifications in your browser to enable chat push alerts.');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      subscription =
        subscription ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(vapidPublicKey),
        }));
      const response = await fetch('/api/member/chat/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error('Could not save this device. Please try again.');
      }
      setStatus('enabled');
      setNotice('Push notifications are enabled on this device.');
    } catch (cause) {
      setStatus('failed');
      setError(cause instanceof Error ? cause.message : 'Could not update push settings.');
    } finally {
      setBusy(false);
    }
  }

  const enabled = status === 'enabled';
  const unavailable = status === 'unsupported' || status === 'denied';
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        Browser alerts can notify you about new chat messages when this site is closed. Your Show
        all / mentions / don’t show preference still applies. This enables push notifications on
        this device only.
      </p>
      <Button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={busy || status === 'loading' || unavailable}
        variant={enabled ? 'default' : 'outline'}
        onClick={() => void togglePush()}
      >
        {busy || status === 'loading' ? (
          <TennisLoader compact label={busy ? 'Updating' : 'Loading'} />
        ) : enabled ? (
          'Disable on this device'
        ) : (
          'Enable on this device'
        )}
      </Button>
      {status === 'unsupported' && (
        <p className="text-sm text-muted-foreground" role="status">
          This browser does not support push notifications. Try an up-to-date browser on a secure
          connection.
        </p>
      )}
      {status === 'denied' && (
        <p className="text-sm text-muted-foreground" role="status">
          Notifications are blocked by your browser. Change this site’s notification permission in
          browser settings, then reload this page.
        </p>
      )}
      {status === 'failed' && !error && (
        <p className="text-sm text-muted-foreground" role="status">
          Could not read this device’s push settings. Try reloading the page.
        </p>
      )}
      {notice && (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
