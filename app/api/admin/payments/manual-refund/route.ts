import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const auth = await createSupabaseServerClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    const { data: profile } = await auth
      .from('profiles')
      .select('role,application_status')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.role !== 'admin' || profile.application_status !== 'approved')
      return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
    const body = await request.json();
    if (
      typeof body.paymentId !== 'string' ||
      !Number.isSafeInteger(body.amountMinor) ||
      body.amountMinor <= 0 ||
      typeof body.idempotencyKey !== 'string' ||
      body.idempotencyKey.length < 1 ||
      body.idempotencyKey.length > 200 ||
      (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500))
    ) {
      return NextResponse.json({ error: 'Invalid manual refund request.' }, { status: 400 });
    }
    const { data, error } = await auth.rpc('record_manual_interac_refund', {
      p_payment_id: body.paymentId,
      p_amount_minor: body.amountMinor,
      p_note: typeof body.note === 'string' ? body.note.trim() || null : null,
      p_idempotency_key: body.idempotencyKey,
    });
    if (error)
      return NextResponse.json(
        { error: error.message || 'Could not record manual refund.' },
        { status: 400 },
      );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Could not record manual refund.' }, { status: 500 });
  }
}
