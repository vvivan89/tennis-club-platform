import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST() {
  const session = await createSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: 'Chat image cleanup is not configured.' }, { status: 503 });
  }

  const serviceClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('application_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.application_status !== 'approved') {
    return NextResponse.json({ error: 'Approved membership required.' }, { status: 403 });
  }

  const { data, error: queueError } = await serviceClient
    .from('member_chat_image_cleanup_queue')
    .select('id,image_path')
    .order('created_at', { ascending: true })
    .limit(100);
  if (queueError)
    return NextResponse.json({ error: 'Unable to load image cleanup queue.' }, { status: 500 });
  const queued = (data ?? []) as Array<{ id: number; image_path: string }>;
  if (!queued.length) return NextResponse.json({ processed: 0 });

  const paths = [...new Set(queued.map((item) => item.image_path))];
  const { error: storageError } = await serviceClient.storage
    .from('member-chat-images')
    .remove(paths);
  if (storageError) {
    return NextResponse.json({ error: 'Unable to remove old chat images.' }, { status: 500 });
  }

  const ids = queued.map((item) => item.id);
  const { error: deleteError } = await serviceClient
    .from('member_chat_image_cleanup_queue')
    .delete()
    .in('id', ids);
  if (deleteError) {
    return NextResponse.json(
      { error: 'Images were removed, but the cleanup queue could not be cleared.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ processed: queued.length });
}
