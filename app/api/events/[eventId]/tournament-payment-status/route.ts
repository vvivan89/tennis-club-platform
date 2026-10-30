import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { eventId: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  const eventId = params.eventId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 });
  }

  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: 'Tournament payment status is unavailable.' },
      { status: 503 },
    );
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: event, error: eventError } = await db
    .from('events')
    .select('id,event_type')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError)
    return NextResponse.json({ error: 'Could not load tournament.' }, { status: 500 });
  if (!event || event.event_type !== 'tournament') {
    return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });
  }

  const { data: ownRows, error: ownError } = await db
    .from('tournament_participants')
    .select('id,payment_status,amount_cents,category')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .eq('status', 'registered');
  if (ownError)
    return NextResponse.json({ error: 'Could not load payment status.' }, { status: 500 });

  const ownIds = (ownRows ?? []).map((row) => row.id as string);
  const paymentStatusById: Record<string, string> = {};
  for (const row of ownRows ?? []) paymentStatusById[row.id] = row.payment_status;
  if (ownIds.length) {
    const { data: allPairs, error: pairError } = await db
      .from('tournament_pairs')
      .select('player_one_id,player_two_id,status')
      .eq('event_id', eventId)
      .neq('status', 'withdrawn');
    if (pairError)
      return NextResponse.json({ error: 'Could not load team payment status.' }, { status: 500 });
    const partnerIds = new Set<string>();
    for (const pair of allPairs ?? []) {
      if (ownIds.includes(pair.player_one_id)) partnerIds.add(pair.player_two_id);
      if (ownIds.includes(pair.player_two_id)) partnerIds.add(pair.player_one_id);
    }
    for (const id of ownIds) partnerIds.delete(id);
    if (partnerIds.size) {
      const { data: partnerRows, error: partnerError } = await db
        .from('tournament_participants')
        .select('id,payment_status')
        .eq('event_id', eventId)
        .in('id', [...partnerIds]);
      if (partnerError)
        return NextResponse.json(
          { error: 'Could not load partner payment status.' },
          { status: 500 },
        );
      for (const row of partnerRows ?? []) paymentStatusById[row.id] = row.payment_status;
    }
  }

  return NextResponse.json(
    { paymentStatusById },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
