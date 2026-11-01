import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function getSupabasePublicConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Cookie-backed server client; Server Components set `ignoreCookieWriteErrors` as they cannot always write cookies. */
export function createCookieSupabaseClient(
  url: string,
  key: string,
  cookieStore: ReturnType<typeof cookies>,
  { ignoreCookieWriteErrors = false }: { ignoreCookieWriteErrors?: boolean } = {},
) {
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Parameters<typeof cookieStore.set>[2];
        }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch (error) {
          // Middleware refreshes sessions when a Server Component cannot write cookies.
          if (!ignoreCookieWriteErrors) throw error;
        }
      },
    },
  });
}

export async function createSupabaseServerClient() {
  const { url, key } = getSupabasePublicConfig();

  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.',
    );
  }

  return createCookieSupabaseClient(url, key, cookies(), { ignoreCookieWriteErrors: true });
}
