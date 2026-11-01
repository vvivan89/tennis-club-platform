import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { createCookieSupabaseClient, getSupabasePublicConfig } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next');
  const safeNext = safeRedirectPath(next, '/member/dashboard');

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
