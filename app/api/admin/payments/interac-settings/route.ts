import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createPaymentServiceClient } from '@/lib/payments/server';

async function adminContext() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user)
    return { response: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) };
  const { data: profile } = await auth
    .from('profiles')
    .select('role,application_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin' || profile.application_status !== 'approved')
    return {
      response: NextResponse.json({ error: 'Administrator access required.' }, { status: 403 }),
    };
  return { auth, user };
}
export async function GET() {
  const context = await adminContext();
  if ('response' in context) return context.response;
  const db = createPaymentServiceClient();
  const { data, error } = await db
    .from('payment_method_settings')
    .select('interac_enabled,interac_recipient_email,interac_instructions,updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: 'Could not load Interac settings.' }, { status: 500 });
  return NextResponse.json({ settings: data });
}
export async function PUT(request: Request) {
  const context = await adminContext();
  if ('response' in context) return context.response;
  try {
    const body = await request.json();
    const recipient = typeof body.recipientEmail === 'string' ? body.recipientEmail.trim() : '';
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    const enabled = body.enabled === true;
    if (recipient.length > 254 || instructions.length > 5000)
      return NextResponse.json({ error: 'Email or instructions are too long.' }, { status: 400 });
    if (enabled && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !instructions))
      return NextResponse.json(
        {
          error: 'Enter a valid Interac recipient email and instructions before enabling Interac.',
        },
        { status: 400 },
      );
    const db = createPaymentServiceClient();
    const { error } = await db.from('payment_method_settings').upsert(
      {
        id: 1,
        interac_enabled: enabled,
        interac_recipient_email: recipient,
        interac_instructions: instructions,
        updated_at: new Date().toISOString(),
        updated_by: context.user.id,
      },
      { onConflict: 'id' },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Admin payments] Interac settings save failed', error);
    return NextResponse.json({ error: 'Could not save Interac settings.' }, { status: 500 });
  }
}
