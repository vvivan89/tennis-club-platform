import { createClient } from '@supabase/supabase-js';

/** Service-role client for server-only code; defaults to the configured env credentials. */
export function createServiceRoleClient(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY,
) {
  return createClient(url as string, key as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
