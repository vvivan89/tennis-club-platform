import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

/** Returns the browser Supabase client and the signed-in user, or throws when signed out. */
export async function requireBrowserUser(message = 'Sign in again.') {
  const db = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error(message);
  return { db, user };
}

/** Returns the browser client for an admin user; otherwise redirects and returns null. */
export async function getAdminBrowserClient(
  router: { replace: (path: string) => void },
  loginPath: string,
) {
  const db = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    router.replace(loginPath);
    return null;
  }
  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') {
    router.replace('/member/dashboard');
    return null;
  }
  return db;
}
