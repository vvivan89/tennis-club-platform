import { NextResponse } from 'next/server';
import { getSignedInUser, getConfiguredServiceClient } from '@/lib/api-helpers';

export async function POST() {
  const { user, response: authError } = await getSignedInUser();
  if (authError) return authError;

  const { db: serviceClient, response: configError } = getConfiguredServiceClient(
    'Chat image cleanup is not configured.',
  );
  if (configError) return configError;
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
