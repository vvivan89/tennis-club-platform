import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { eventId: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  const eventId = params.eventId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Organizer contacts are unavailable.' }, { status: 503 });
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: event, error: eventError } = await db
    .from('events')
    .select('id,event_type,status,organizer_id,created_by')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) return NextResponse.json({ error: 'Could not load event.' }, { status: 500 });
  if (!event || event.event_type !== 'tournament' || event.status !== 'published') {
    return NextResponse.json(
      { error: 'Organizer contacts are available only for published tournaments.' },
      { status: 404 },
    );
  }

  const organizerId = event.organizer_id || event.created_by;
  if (!organizerId)
    return NextResponse.json({ contacts: [] }, { headers: { 'Cache-Control': 'no-store' } });

  const [{ data: profile, error: profileError }, { data: clubContact, error: contactError }] =
    await Promise.all([
      db
        .from('profiles')
        .select('id,full_name,email,phone,role')
        .eq('id', organizerId)
        .maybeSingle(),
      db
        .from('club_contacts')
        .select('position,emails,phones')
        .eq('profile_id', organizerId)
        .maybeSingle(),
    ]);
  if (profileError || contactError) {
    return NextResponse.json({ error: 'Could not load organizer contacts.' }, { status: 500 });
  }
  if (!profile)
    return NextResponse.json({ contacts: [] }, { headers: { 'Cache-Control': 'no-store' } });

  const emails =
    Array.isArray(clubContact?.emails) && clubContact.emails.length
      ? clubContact.emails.filter(
          (value): value is string => typeof value === 'string' && !!value.trim(),
        )
      : profile.email
        ? [profile.email]
        : [];
  const phones =
    Array.isArray(clubContact?.phones) && clubContact.phones.length
      ? clubContact.phones.filter(
          (value): value is string => typeof value === 'string' && !!value.trim(),
        )
      : profile.phone
        ? [profile.phone]
        : [];

  return NextResponse.json(
    {
      contacts: [
        {
          organizer_name: profile.full_name || profile.email || 'Event organizer',
          position:
            clubContact?.position ||
            (profile.role === 'organizer' ? 'Event organizer' : 'Club administrator'),
          emails,
          phones,
        },
      ],
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
