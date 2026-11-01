import { NextResponse } from 'next/server';
import { getConfiguredServiceClient, getSignedInUser, isUuid } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { eventId: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  const eventId = params.eventId;
  if (!isUuid(eventId)) {
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 });
  }

  const { user, response: authError } = await getSignedInUser();
  if (authError) return authError;

  const { db, response: configError } = getConfiguredServiceClient(
    'Tournament payment status is unavailable.',
  );
  if (configError) return configError;
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
