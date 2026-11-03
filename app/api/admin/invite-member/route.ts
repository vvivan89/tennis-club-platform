import { NextResponse } from 'next/server';
import { getSiteOrigin } from '@/lib/site-url';
import { enforceRateLimit } from '@/lib/rate-limit';
import { checkAdminRole, getConfiguredServiceClient, getSignedInUser } from '@/lib/api-helpers';
const validLevels = new Set(['2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0']);
export async function POST(request: Request) {
  try {
    const {
      auth: session,
      user,
      response: authError,
    } = await getSignedInUser('Sign in as an administrator.');
    if (authError) return authError;
    const adminError = await checkAdminRole(session, user.id);
    if (adminError) return adminError;
    const body = await request.json();
    const full_name = String(body.full_name ?? '').trim();
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const phone = String(body.phone ?? '').trim();
    const tennis_skill_level = String(body.tennis_skill_level ?? '');
    const gender = String(body.gender ?? '').trim();
    const date_of_birth = String(body.date_of_birth ?? '').trim();
    if (!full_name || !email || !phone || !validLevels.has(tennis_skill_level))
      return NextResponse.json(
        { error: 'Name, valid email, phone, and skill rating are required.' },
        { status: 400 },
      );
    if (gender && !['male', 'female'].includes(gender))
      return NextResponse.json({ error: 'Choose a valid gender.' }, { status: 400 });
    if (
      date_of_birth &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth) ||
        Number.isNaN(Date.parse(`${date_of_birth}T00:00:00Z`)) ||
        new Date(`${date_of_birth}T00:00:00Z`).toISOString().slice(0, 10) !== date_of_birth ||
        date_of_birth > new Date().toISOString().slice(0, 10))
    )
      return NextResponse.json({ error: 'Choose a valid date of birth.' }, { status: 400 });
    const limited = await enforceRateLimit(request, {
      name: 'invite-member',
      limit: 100,
      windowSeconds: 3600,
      userId: user.id,
    });
    if (limited) return limited;
    const { db: admin, response: configError } = getConfiguredServiceClient(
      'Server configuration is missing SUPABASE_SERVICE_ROLE_KEY.',
      500,
    );
    if (configError) return configError;
    const origin = getSiteOrigin(request);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
      data: {
        full_name,
        phone,
        tennis_skill_level,
        gender: gender || null,
        date_of_birth: date_of_birth || null,
      },
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
