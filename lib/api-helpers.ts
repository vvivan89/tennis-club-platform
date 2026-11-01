import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createServiceRoleClient } from '@/lib/supabase-service';

export const jsonError = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Resolves the signed-in user, or a 401 response to return as-is. */
export async function getSignedInUser(message = 'Sign in required.') {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { auth, user: null, response: jsonError(message, 401) };
  return { auth, user, response: null };
}

/** Builds the service-role client, or the error response to return when env is missing. */
export function getConfiguredServiceClient(message: string, status = 503) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { db: null, response: jsonError(message, status) };
  return { db: createServiceRoleClient(url, key), response: null };
}

/** Returns a 403 response unless the user is an admin (and approved, when requested). */
export async function checkAdminRole(
  db: Pick<SupabaseClient, 'from'>,
  userId: string,
  { approved = false }: { approved?: boolean } = {},
) {
  const { data: me } = await db
    .from('profiles')
    .select('role,application_status')
    .eq('id', userId)
    .maybeSingle();
  if (me?.role !== 'admin' || (approved && me.application_status !== 'approved'))
    return jsonError('Administrator access required.', 403);
  return null;
}

/** Constant-time check of a `Bearer <secret>` authorization header. */
export function matchesBearerSecret(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export function isCronAuthorized(request: Request) {
  return matchesBearerSecret(request.headers.get('authorization'), process.env.CRON_SECRET);
}
