import { NextResponse } from 'next/server';
import { getConfiguredServiceClient, getSignedInUser } from '@/lib/api-helpers';

export const runtime = 'nodejs';

const validEndpoint = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const endpoint = new URL(value);
    const host = endpoint.hostname.toLowerCase();
    const knownPushService =
      [
        'fcm.googleapis.com',
        'gcm-http.googleapis.com',
        'updates.push.services.mozilla.com',
        'push.services.mozilla.com',
        'web.push.apple.com',
      ].includes(host) || host.endsWith('.notify.windows.com');
    return (
      endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && knownPushService
    );
  } catch {
    return false;
  }
};

async function getApprovedMember() {
  const { user, response: authError } = await getSignedInUser();
  if (authError) return { user: null, db: null, response: authError };
  const { db, response: configError } = getConfiguredServiceClient(
    'Push notifications are not configured.',
  );
  if (configError) return { user: null, db: null, response: configError };
  const { data: profile, error } = await db
    .from('profiles')
    .select('application_status')
    .eq('id', user.id)
    .maybeSingle();
  if (error)
    return {
      user: null,
      db: null,
      response: NextResponse.json({ error: 'Could not verify membership.' }, { status: 500 }),
    };
  if (profile?.application_status !== 'approved')
    return {
      user: null,
      db: null,
      response: NextResponse.json({ error: 'Approved membership required.' }, { status: 403 }),
    };
  return { user, db, response: null };
}

export async function POST(request: Request) {
  const { user, db, response } = await getApprovedMember();
  if (response) return response;

  try {
    const body = (await request.json()) as {
      action?: unknown;
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    if (!validEndpoint(body.endpoint)) {
      return NextResponse.json(
        { error: 'A valid push subscription endpoint is required.' },
        { status: 400 },
      );
    }

    if (body.action === 'status') {
      const { data, error } = await db
        .from('member_chat_push_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('endpoint', body.endpoint)
        .eq('enabled', true)
        .maybeSingle();
      if (error)
        return NextResponse.json({ error: 'Could not check this device.' }, { status: 500 });
      return NextResponse.json(
        { enabled: Boolean(data) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (
      typeof body.keys?.p256dh !== 'string' ||
      body.keys.p256dh.length > 512 ||
      typeof body.keys?.auth !== 'string' ||
      body.keys.auth.length > 512
    )
      return NextResponse.json(
        { error: 'The browser push subscription is invalid.' },
        { status: 400 },
      );

    const { error } = await db.from('member_chat_push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );
    if (error) {
      console.error('[Chat push] Could not save device subscription', error.message);
      return NextResponse.json(
        { error: 'Could not save push settings. Please try again.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ enabled: true });
  } catch {
    return NextResponse.json(
      { error: 'The browser push subscription is invalid.' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const { user, db, response } = await getApprovedMember();
  if (response) return response;

  try {
    const body = (await request.json()) as { endpoint?: unknown };
    if (!validEndpoint(body.endpoint))
      return NextResponse.json(
        { error: 'A valid push subscription endpoint is required.' },
        { status: 400 },
      );
    const { error } = await db
      .from('member_chat_push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', body.endpoint);
    if (error)
      return NextResponse.json(
        { error: 'Could not disable push on this device.' },
        { status: 500 },
      );
    return NextResponse.json({ enabled: false });
  } catch {
    return NextResponse.json({ error: 'The request was invalid.' }, { status: 400 });
  }
}
