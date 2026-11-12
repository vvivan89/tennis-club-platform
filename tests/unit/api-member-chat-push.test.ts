import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-000000000001' } as null | { id: string },
  profile: { application_status: 'approved' } as null | { application_status: string },
  message: {
    id: '00000000-0000-4000-8000-000000000010',
    user_id: '00000000-0000-4000-8000-000000000001',
    body: 'Hello from the chat',
    image_path: null,
    mentions: ['00000000-0000-4000-8000-000000000003'],
    deleted_at: null,
  } as null | {
    id: string;
    user_id: string;
    body: string;
    image_path: string | null;
    mentions: string[];
    deleted_at: string | null;
  },
  profiles: [] as Array<{ id: string; chat_notification_preference: 'all' | 'mentions' | 'none' }>,
  subscriptions: [] as Array<{
    id: string;
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>,
  claimJob: true,
  claimedDeliveries: new Set<string>(),
  sent: [] as Array<{ endpoint: string; payload: string }>,
  deletedSubscriptions: [] as string[],
  createClient: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock('@/lib/api-helpers', () => ({
  getSignedInUser: async () =>
    mocks.user
      ? { user: mocks.user, response: null }
      : { user: null, response: Response.json({ error: 'Sign in required.' }, { status: 401 }) },
  getConfiguredServiceClient: () => ({ db: mocks.createClient(), response: null }),
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
}));
vi.mock('web-push', () => ({
  setVapidDetails: mocks.setVapidDetails,
  sendNotification: mocks.sendNotification,
}));

import { POST } from '@/app/api/member/chat/push/route';

function serviceClient() {
  return {
    from: (table: string) => {
      let operation = 'select';
      let updateValues: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        neq: (column: string, value: unknown) => {
          filters[`not_${column}`] = value;
          return query;
        },
        in: (column: string, values: string[]) => {
          filters[column] = values;
          return query;
        },
        order: () => query,
        range: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : mocks.message,
          error: null,
        }),
        update: (values: Record<string, unknown>) => {
          operation = 'update';
          updateValues = values;
          return query;
        },
        delete: () => {
          operation = 'delete';
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (table === 'member_chat_push_subscriptions' && operation === 'delete')
            mocks.deletedSubscriptions.push(String(filters.id));
          const data =
            operation === 'select' && table === 'profiles'
              ? mocks.profiles.filter(
                  (row) =>
                    row.id !== filters.not_id &&
                    (!Array.isArray(filters.id) || (filters.id as string[]).includes(row.id)),
                )
              : operation === 'select' && table === 'member_chat_push_subscriptions'
                ? mocks.subscriptions.filter(
                    (row) =>
                      row.user_id !== filters.not_user_id &&
                      (!Array.isArray(filters.user_id) ||
                        (filters.user_id as string[]).includes(row.user_id)),
                  )
                : null;
          void updateValues;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async (name: string, params: { p_message_id?: string; p_subscription_id?: string }) => {
      if (name === 'claim_member_chat_push_job') return { data: mocks.claimJob, error: null };
      if (name === 'claim_member_chat_push_delivery') {
        const key = `${params.p_message_id}:${params.p_subscription_id}`;
        if (mocks.claimedDeliveries.has(key)) return { data: false, error: null };
        mocks.claimedDeliveries.add(key);
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
  };
}

const senderId = '00000000-0000-4000-8000-000000000001';
const messageId = '00000000-0000-4000-8000-000000000010';
const mentionedId = '00000000-0000-4000-8000-000000000003';

function request() {
  return new Request('https://club.example/api/member/chat/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId }),
  });
}

beforeEach(() => {
  mocks.user = { id: senderId };
  mocks.profile = { application_status: 'approved' };
  mocks.message = {
    id: messageId,
    user_id: senderId,
    body: 'Hello from the chat',
    image_path: null,
    mentions: [mentionedId],
    deleted_at: null,
  };
  mocks.profiles = [
    { id: senderId, chat_notification_preference: 'all' },
    { id: '00000000-0000-4000-8000-000000000002', chat_notification_preference: 'all' },
    { id: mentionedId, chat_notification_preference: 'mentions' },
    { id: '00000000-0000-4000-8000-000000000004', chat_notification_preference: 'mentions' },
    { id: '00000000-0000-4000-8000-000000000005', chat_notification_preference: 'none' },
  ];
  mocks.subscriptions = mocks.profiles.map((profile, index) => ({
    id: `subscription-${index}`,
    user_id: profile.id,
    endpoint: `https://fcm.googleapis.com/${profile.id}`,
    p256dh: 'public-key',
    auth: 'auth-key',
  }));
  mocks.claimJob = true;
  mocks.claimedDeliveries = new Set();
  mocks.sent = [];
  mocks.deletedSubscriptions = [];
  mocks.createClient.mockImplementation(serviceClient);
  mocks.sendNotification.mockImplementation(async (subscription, payload) => {
    mocks.sent.push({ endpoint: subscription.endpoint, payload });
    return {};
  });
  mocks.setVapidDetails.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.stubEnv('NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY', 'public-vapid-key');
  vi.stubEnv('WEB_PUSH_PRIVATE_KEY', 'private-vapid-key');
  vi.stubEnv('WEB_PUSH_SUBJECT', 'mailto:admin@example.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/member/chat/push', () => {
  it('notifies eligible recipients, excludes the sender, and includes the chat message text', async () => {
    mocks.subscriptions.push({
      id: 'subscription-extra-device',
      user_id: '00000000-0000-4000-8000-000000000002',
      endpoint: 'https://fcm.googleapis.com/second-device',
      p256dh: 'second-public-key',
      auth: 'second-auth-key',
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 3, failed: 0 });
    expect(mocks.sent.map((item) => item.endpoint)).toEqual([
      'https://fcm.googleapis.com/00000000-0000-4000-8000-000000000002',
      `https://fcm.googleapis.com/${mentionedId}`,
      'https://fcm.googleapis.com/second-device',
    ]);
    expect(JSON.parse(mocks.sent[0].payload)).toMatchObject({ body: 'Hello from the chat' });
    expect(mocks.setVapidDetails).toHaveBeenCalledOnce();
  });

  it('uses a short image notice for image-only posts and limits long notification text', async () => {
    mocks.message = {
      id: messageId,
      user_id: senderId,
      body: '',
      image_path: 'chat/image.jpg',
      mentions: [],
      deleted_at: null,
    };
    await POST(request());
    expect(JSON.parse(mocks.sent[0].payload).body).toBe('Sent an image.');

    mocks.sent = [];
    mocks.message = {
      id: messageId,
      user_id: senderId,
      body: 'A'.repeat(4000),
      image_path: null,
      mentions: [],
      deleted_at: null,
    };
    mocks.claimedDeliveries = new Set();
    await POST(request());
    expect(JSON.parse(mocks.sent[0].payload).body).toBe(`${'A'.repeat(237)}...`);
    expect(JSON.parse(mocks.sent[0].payload).body).toHaveLength(240);
  });

  it('does not resend a job or a device delivery that was already claimed', async () => {
    mocks.claimJob = false;
    const response = await POST(request());
    expect(await response.json()).toEqual({ sent: 0, duplicate: true });
    expect(mocks.sendNotification).not.toHaveBeenCalled();

    mocks.claimJob = true;
    mocks.claimedDeliveries = new Set([
      `${messageId}:subscription-1`,
      `${messageId}:subscription-2`,
      `${messageId}:subscription-extra-device`,
    ]);
    await POST(request());
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('requires the signed-in approved sender of the message', async () => {
    mocks.message = {
      id: messageId,
      user_id: 'another-member',
      body: 'Hello',
      image_path: null,
      mentions: [],
      deleted_at: null,
    };
    expect((await POST(request())).status).toBe(403);
    mocks.message = {
      id: messageId,
      user_id: senderId,
      body: 'Hello',
      image_path: null,
      mentions: [],
      deleted_at: null,
    };
    mocks.profile = { application_status: 'pending' };
    expect((await POST(request())).status).toBe(403);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('removes endpoints that the push service says are expired or revoked', async () => {
    mocks.subscriptions = [mocks.subscriptions[1]];
    mocks.profiles = [mocks.profiles[1]];
    mocks.sendNotification.mockRejectedValueOnce(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    );
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.deletedSubscriptions).toContain('subscription-1');
  });
});
