'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TennisLoader } from '@/components/tennis-loader';

export function EmailUnsubscribeConfirmation({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [token]);

  async function unsubscribe() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/email-preferences/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        alreadyUsed?: boolean;
        label?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Could not update your email preference.');
      if (result.alreadyUsed) {
        setMessage('This unsubscribe link has already been used.');
      } else {
        setMessage(`You are unsubscribed from ${result.label || 'this email category'}.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your email preference.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Email preferences</CardTitle>
        <CardDescription>
          Confirm that you want to stop receiving this type of club email. You do not need to sign
          in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!token ? (
          <p role="alert" className="text-sm text-destructive">
            This unsubscribe link is invalid or has expired.
          </p>
        ) : message ? (
          <p role="status" className="text-sm text-success-foreground">
            {message}
          </p>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="button" className="w-full" disabled={busy} onClick={unsubscribe}>
              {busy ? <TennisLoader compact label="Updating preference" /> : 'Unsubscribe'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
