import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1' } as null | { id: string },
  profile: { application_status: 'approved' } as null | { application_status: string },
  enabled: true,
  saved: [] as Array<{ table: string; values: Record<string, unknown>; conflict?: string }>,
  deleted: [] as Array<{ userId?: string; endpoint?: string }>,
}));

vi.mock('@/lib/api-helpers', () => ({
  getSignedInUser: async () =>
    mocks.user
      ? { user: mocks.user, response: null }
      : { user: null, response: Response.json({ error: 'Sign in required.' }, { status: 401 }) },
  getConfiguredServiceClient: () => ({ db: database(), response: null }),
}));

function database() {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let operation = 'select';
      let values: Record<string, unknown> = {};
      let conflict: string | undefined;
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: async () => ({
          data:
            table === 'profiles' ? mocks.profile : mocks.enabled ? { id: 'subscription-1' } : null,
          error: null,
        }),
        upsert: (record: Record<string, unknown>, options?: { onConflict?: string }) => {
          operation = 'upsert';
          values = record;
          conflict = options?.onConflict;
          return query;
        },
        delete: () => {
          operation = 'delete';
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (operation === 'upsert') mocks.saved.push({ table, values, conflict });
          if (operation === 'delete')
            mocks.deleted.push({
              userId: String(filters.user_id),
              endpoint: String(filters.endpoint),
            });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

import { DELETE, POST } from '@/app/api/member/chat/push-subscriptions/route';

const endpoint = 'https://fcm.googleapis.com/subscription-1';

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.profile = { application_status: 'approved' };
  mocks.enabled = true;
  mocks.saved = [];
  mocks.deleted = [];
});
afterEach(() => vi.clearAllMocks());

describe('chat push subscription API', () => {
  it('reports whether this device is enabled for the current member', async () => {
    const response = await POST(
      new Request('https://club.example/api/member/chat/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', endpoint }),
      }),
    );
    expect(await response.json()).toEqual({ enabled: true });
    mocks.enabled = false;
    const disabled = await POST(
      new Request('https://club.example/api/member/chat/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', endpoint }),
      }),
    );
    expect(await disabled.json()).toEqual({ enabled: false });
  });

  it('saves endpoint keys against the authenticated account and removes only that account’s device', async () => {
    const subscription = {
      endpoint,
      keys: { p256dh: 'browser-public-key', auth: 'browser-auth-secret' },
    };
    const saved = await POST(
      new Request('https://club.example/api/member/chat/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      }),
    );
    expect(saved.status).toBe(200);
    expect(mocks.saved[0]).toMatchObject({
      table: 'member_chat_push_subscriptions',
      conflict: 'endpoint',
      values: {
        user_id: 'member-1',
        endpoint,
        p256dh: 'browser-public-key',
        auth: 'browser-auth-secret',
        enabled: true,
      },
    });

    const removed = await DELETE(
      new Request('https://club.example/api/member/chat/push-subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }),
    );
    expect(removed.status).toBe(200);
    expect(mocks.deleted).toEqual([{ userId: 'member-1', endpoint }]);
  });

  it('rejects unapproved accounts and malformed endpoints', async () => {
    mocks.profile = { application_status: 'pending' };
    const unapproved = await POST(
      new Request('https://club.example/api/member/chat/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, keys: { p256dh: 'key', auth: 'key' } }),
      }),
    );
    expect(unapproved.status).toBe(403);

    mocks.profile = { application_status: 'approved' };
    const invalid = await DELETE(
      new Request('https://club.example/api/member/chat/push-subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://attacker.example/insecure' }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(mocks.deleted).toHaveLength(0);
  });
});
