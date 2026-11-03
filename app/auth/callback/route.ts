import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { createCookieSupabaseClient, getSupabasePublicConfig } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next');
  const safeNext = safeRedirectPath(next, '/member/dashboard');

  // Server-generated OTP links use Supabase's implicit flow, whose tokens arrive
  // in the URL fragment and are invisible to this route handler. The browser
  // callback can establish that session before returning to the requested page.
  if (!code) {
    const tokenCallback = new URL('/auth/guest-callback', requestUrl.origin);
    tokenCallback.searchParams.set('next', safeNext);
    return NextResponse.redirect(tokenCallback);
  }

  if (code) {
    const { url, key } = getSupabasePublicConfig();
    if (!url || !key)
      return NextResponse.redirect(new URL('/login?error=configuration', requestUrl.origin));

    const supabase = createCookieSupabaseClient(url, key, await cookies());
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
  }

  return NextResponse.redirect(new URL('/login?error=confirmation', requestUrl.origin));
}
