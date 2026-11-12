import { NextResponse } from 'next/server';
import * as webpush from 'web-push';
import { getConfiguredServiceClient, getSignedInUser, isUuid } from '@/lib/api-helpers';
import { fetchAllRows } from '@/lib/fetch-all-rows';
import { mapInChunks } from '@/lib/async';
import { shouldShowChatNotification } from '@/lib/member-chat';

export const runtime = 'nodejs';

type ChatProfile = { id: string; chat_notification_preference: 'all' | 'mentions' | 'none' | null };
type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function POST(request: Request) {
  const { user, response: authError } = await getSignedInUser();
  if (authError) return authError;

  const { db, response: configError } = getConfiguredServiceClient(
    'Chat push notifications are not configured.',
  );
  if (configError) return configError;

  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  if (!publicKey || !privateKey || !subject)
    return NextResponse.json(
      { error: 'Chat push notifications are not configured.' },
      { status: 503 },
    );

  let messageId = '';
  try {
    const body = (await request.json()) as { messageId?: unknown };
    if (typeof body.messageId !== 'string' || !isUuid(body.messageId))
      return NextResponse.json({ error: 'A valid chat message ID is required.' }, { status: 400 });
    messageId = body.messageId;
  } catch {
    return NextResponse.json({ error: 'The request was invalid.' }, { status: 400 });
  }

  const [{ data: profile, error: profileError }, { data: message, error: messageError }] =
    await Promise.all([
      db.from('profiles').select('application_status,full_name').eq('id', user.id).maybeSingle(),
      db
        .from('member_chat_messages')
        .select('id,user_id,body,image_path,mentions,deleted_at')
        .eq('id', messageId)
        .maybeSingle(),
    ]);
  if (profileError || messageError)
    return NextResponse.json({ error: 'Could not verify this chat message.' }, { status: 500 });
  if (profile?.application_status !== 'approved')
    return NextResponse.json({ error: 'Approved membership required.' }, { status: 403 });
  if (!message || message.user_id !== user.id || message.deleted_at)
    return NextResponse.json(
      { error: 'This chat message cannot send notifications.' },
      { status: 403 },
    );

  const { data: claimed, error: claimError } = await db.rpc('claim_member_chat_push_job', {
    p_message_id: messageId,
  });
  if (claimError)
    return NextResponse.json(
      { error: 'Could not claim chat notification delivery.' },
      { status: 500 },
    );
  if (!claimed)
    return NextResponse.json(
      { sent: 0, duplicate: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );

  const { rows: allSubscriptions, error: subscriptionsError } =
    await fetchAllRows<PushSubscriptionRow>((from, to) =>
      db
        .from('member_chat_push_subscriptions')
        .select('id,user_id,endpoint,p256dh,auth')
        .eq('enabled', true)
        .neq('user_id', user.id)
        .order('id')
        .range(from, to),
    );
  if (subscriptionsError) {
    await db
      .from('member_chat_push_queue')
      .update({
        status: 'failed',
        last_error: 'Could not load device subscriptions.',
        updated_at: new Date().toISOString(),
      })
      .eq('message_id', messageId);
    return NextResponse.json({ error: 'Could not load device subscriptions.' }, { status: 500 });
  }
  if (!allSubscriptions.length) {
    await db
      .from('member_chat_push_queue')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('message_id', messageId);
    return NextResponse.json({ sent: 0, failed: 0 });
  }

  const subscriberIds = [...new Set(allSubscriptions.map((subscription) => subscription.user_id))];
  const { rows: profiles, error: recipientsError } = await fetchAllRows<ChatProfile>((from, to) =>
    db
      .from('profiles')
      .select('id,chat_notification_preference')
      .eq('application_status', 'approved')
      .neq('id', user.id)
      .in('id', subscriberIds)
      .order('id')
      .range(from, to),
  );
  if (recipientsError) {
    await db
      .from('member_chat_push_queue')
      .update({
        status: 'failed',
        last_error: 'Could not load chat recipients.',
        updated_at: new Date().toISOString(),
      })
      .eq('message_id', messageId);
    return NextResponse.json({ error: 'Could not load chat recipients.' }, { status: 500 });
  }

  const mentions = Array.isArray(message.mentions) ? (message.mentions as string[]) : [];
  const recipientIds = new Set(
    profiles
      .filter((recipient) =>
        shouldShowChatNotification(
          recipient.chat_notification_preference || 'all',
          user.id,
          recipient.id,
          mentions,
        ),
      )
      .map((recipient) => recipient.id),
  );
  const subscriptions = allSubscriptions.filter((subscription) =>
    recipientIds.has(subscription.user_id),
  );
  if (!subscriptions.length) {
    await db
      .from('member_chat_push_queue')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('message_id', messageId);
    return NextResponse.json({ sent: 0, failed: 0 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  let sent = 0;
  let failed = 0;
  const messageText =
    typeof message.body === 'string' ? message.body.replace(/\s+/g, ' ').trim() : '';
  const notificationBody =
    messageText || (message.image_path ? 'Sent an image.' : 'New chat message.');
  const senderName = profile.full_name?.trim() || 'A club member';
  const notificationTitle = `Message from ${senderName}`;
  const payload = JSON.stringify({
    title:
      notificationTitle.length > 100
        ? `${notificationTitle.slice(0, 97).trimEnd()}...`
        : notificationTitle,
    body:
      notificationBody.length > 240
        ? `${notificationBody.slice(0, 237).trimEnd()}...`
        : notificationBody,
    url: '/member/chat',
    tag: `pctc-chat-${messageId}`,
  });

  await mapInChunks(subscriptions, 20, async (subscription) => {
    const { data: deliveryClaimed, error: deliveryClaimError } = await db.rpc(
      'claim_member_chat_push_delivery',
      { p_message_id: messageId, p_subscription_id: subscription.id },
    );
    if (deliveryClaimError) {
      failed += 1;
      return;
    }
    if (!deliveryClaimed) return;

    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        { TTL: 60, urgency: 'normal' },
      );
      sent += 1;
      await Promise.all([
        db
          .from('member_chat_push_deliveries')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('message_id', messageId)
          .eq('subscription_id', subscription.id),
        db
          .from('member_chat_push_subscriptions')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', subscription.id),
      ]);
    } catch (cause) {
      const statusCode = (cause as { statusCode?: number }).statusCode;
      const expired = statusCode === 404 || statusCode === 410;
      failed += 1;
      await Promise.all([
        db
          .from('member_chat_push_deliveries')
          .update({
            status: expired ? 'expired' : 'failed',
            last_error:
              cause instanceof Error ? cause.message.slice(0, 500) : 'Push provider failed.',
            updated_at: new Date().toISOString(),
          })
          .eq('message_id', messageId)
          .eq('subscription_id', subscription.id),
        ...(expired
          ? [db.from('member_chat_push_subscriptions').delete().eq('id', subscription.id)]
          : []),
      ]);
    }
  });

  await db
    .from('member_chat_push_queue')
    .update({
      status: failed ? 'failed' : 'sent',
      last_error: failed ? `${failed} push delivery attempt(s) failed.` : null,
      updated_at: new Date().toISOString(),
    })
    .eq('message_id', messageId);

  return NextResponse.json({ sent, failed }, { headers: { 'Cache-Control': 'no-store' } });
}
