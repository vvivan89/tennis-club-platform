import { createClient } from '@supabase/supabase-js';

/** Sends an event guest a one-time link to the supplied event-specific destination. */
export async function sendEventGuestSignInLink(email: string, redirectTo: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase authentication is not configured.');

  const authClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return authClient.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { account_kind: 'event_guest' },
      emailRedirectTo: redirectTo,
    },
  });
}
