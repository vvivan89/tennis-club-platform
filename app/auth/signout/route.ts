import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createCookieSupabaseClient, getSupabasePublicConfig } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const { url, key } = getSupabasePublicConfig();
  if (url && key) {
    const supabase = createCookieSupabaseClient(url, key, await cookies());
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
