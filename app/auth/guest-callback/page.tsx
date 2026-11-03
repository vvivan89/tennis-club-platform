'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { navigateToPath } from '@/lib/browser-navigation';

export default function GuestAuthCallbackPage() {
  const authCompletion = useRef<Promise<string | null> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const next = safeRedirectPath(url.searchParams.get('next'), '/events');
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    const linkError = fragment.get('error_description') || fragment.get('error');

    if (!authCompletion.current) {
      authCompletion.current = (async () => {
        try {
          if (linkError) throw new Error(linkError.replaceAll('+', ' '));
          // This page handles the implicit-flow tokens itself. The default browser
          // client also detects URL tokens, which can race this explicit setSession
          // call during client initialization.
          const supabase = createSupabaseBrowserClient({
            isSingleton: false,
            auth: { detectSessionInUrl: false },
          });
          let session = null;

          if (accessToken && refreshToken) {
            const { data, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionError) throw sessionError;
            session = data.session;
          } else {
            const { data, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            session = data.session;
          }

          if (!session) throw new Error('This sign-in link is invalid or has expired.');
          return null;
        } catch (callbackError) {
          return callbackError instanceof Error
            ? callbackError.message
            : 'This sign-in link is invalid or has expired.';
        }
      })();
    }
    void authCompletion.current.then((failure) => {
      if (!active) return;
      if (failure) {
        setError(failure);
        return;
      }
      // Force a document navigation after the auth cookies are persisted. The
      // event page then loads with the new session instead of relying on the
      // App Router to refresh its server session in place.
      navigateToPath(next);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Verifying your sign-in link</h1>
        {error ? (
          <>
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Return to the event page and request a new link to continue registration.
            </p>
            <Link
              href="/events"
              className="mt-4 inline-block text-sm font-medium text-primary underline"
            >
              Browse events
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Your event-only account is being signed in. This page will continue to the event
            shortly.
          </p>
        )}
      </section>
    </main>
  );
}
