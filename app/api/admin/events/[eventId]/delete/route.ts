import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function DELETE(_request: Request, { params }: { params: { eventId: string } }) {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!['admin', 'organizer'].includes(profile?.role ?? ''))
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const { data: event } = await db
    .from('events')
    .select('id,starts_at,created_by,organizer_id')
    .eq('id', params.eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  if (new Date(event.starts_at).getTime() <= Date.now())
    return NextResponse.json({ error: 'Only future events can be deleted.' }, { status: 400 });
  if (
    profile?.role === 'organizer' &&
    event.created_by !== user.id &&
    event.organizer_id !== user.id
  )
    return NextResponse.json({ error: 'Not authorized to delete this event.' }, { status: 403 });
  const { error } = await db.from('events').delete().eq('id', event.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
