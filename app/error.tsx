'use client';

import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';

export default function ApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const db = createSupabaseBrowserClient();
      void db.rpc('record_application_error', {
        p_severity: 'error',
        p_source: 'web',
        p_error_type: error.name || 'UnhandledApplicationError',
        p_message: (error.message || 'Unexpected application error').slice(0, 2000),
        p_route: window.location.pathname,
        p_operation: 'react.error_boundary',
        p_event_id: null,
        p_correlation_id: error.digest ?? null,
        p_details: { digest: error.digest ?? null },
      });
    } catch {
      // Logging must never cause a second application error.
    }
  }, [error]);

  return (
    <main className="page-container flex min-h-[50vh] flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-xl text-muted-foreground">
        The page could not be displayed. The error has been reported when logging is available.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </main>
  );
}
