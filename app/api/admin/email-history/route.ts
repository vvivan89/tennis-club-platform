import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
export async function GET() {
  const session = await createSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json({ error: 'Database is not configured.' }, { status: 503 });
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: me } = await db
    .from('profiles')
    .select('role,application_status')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin' || me.application_status !== 'approved')
    return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
  const { data, error } = await db
    .from('email_announcement_history')
    .select('id,subject,body_html,recipient_group,sent_count,failed_count,sent_at')
    .order('sent_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
