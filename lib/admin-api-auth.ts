import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function getApprovedAdminContext() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return {
      auth: null,
      user: null,
      response: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }),
    };
  }
  const { data: profile } = await auth
    .from('profiles')
    .select('role,application_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin' || profile.application_status !== 'approved') {
    return {
      auth: null,
      user: null,
      response: NextResponse.json({ error: 'Administrator access required.' }, { status: 403 }),
    };
  }
  return { auth, user, response: null };
}
