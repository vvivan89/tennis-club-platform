import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function GET(
  _request: Request,
  { params: paramsPromise }: { params: Promise<{ eventId: string }> },
) {
  const params = await paramsPromise;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      params.eventId,
    )
  ) {
    return NextResponse.json({ error: 'Invalid event ID.' }, { status: 400 });
  }

  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const { data, error } = await db.rpc('event_tournament_pair_payment_status', {
    p_event_id: params.eventId,
  });
  if (error) {
    console.error('[Tournament pair payment status]', error.message);
    return NextResponse.json(
      { error: 'Could not retrieve partner payment status.' },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { data: data ?? [] },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
