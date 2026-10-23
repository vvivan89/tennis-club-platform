import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
const validLevels = new Set(['2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0']);
export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in as an administrator.' }, { status: 401 });
    const { data: me } = await session
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (me?.role !== 'admin')
      return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
    const body = await request.json();
    const full_name = String(body.full_name ?? '').trim();
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const phone = String(body.phone ?? '').trim();
    const tennis_skill_level = String(body.tennis_skill_level ?? '');
    if (!full_name || !email || !phone || !validLevels.has(tennis_skill_level))
      return NextResponse.json(
        { error: 'Name, valid email, phone, and skill rating are required.' },
        { status: 400 },
      );
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      return NextResponse.json(
        { error: 'Server configuration is missing SUPABASE_SERVICE_ROLE_KEY.' },
        { status: 500 },
      );
    const admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const origin = new URL(request.url).origin;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
      data: { full_name, phone, tennis_skill_level },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data.user)
      return NextResponse.json({ error: 'Invitation did not create a user.' }, { status: 500 });
    await admin.from('profiles').update({ application_status: 'approved' }).eq('id', data.user.id);
    const membership = await admin.from('memberships').insert({
      user_id: data.user.id,
      membership_type: 'annual',
      status: 'pending',
      payment_status: 'unpaid',
    });
    if (membership.error)
      return NextResponse.json(
        {
          error: `Invitation sent, but initial membership could not be created: ${membership.error.message}`,
        },
        { status: 500 },
      );
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected server error.' },
      { status: 500 },
    );
  }
}
