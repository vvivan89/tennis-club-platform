// Deprecated compatibility wrapper. New code should use the browser/server helpers.
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
export function getSupabase() {
  return createSupabaseBrowserClient();
}
