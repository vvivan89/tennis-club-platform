import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1' } as null | { id: string },
  profile: { application_status: 'approved' } as null | { application_status: string },
  queued: [{ id: 1, image_path: 'member-1/old-image.png' }],
  queueError: null as null | { message: string },
  storageError: null as null | { message: string },
  deleteError: null as null | { message: string },
  createClient: vi.fn(),
  removedPaths: [] as string[][],
  deletedIds: [] as number[][],
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { POST } from '@/app/api/member/chat/cleanup-images/route';

function serviceClient() {
  return {
    from: (table: string) => {
      let operation = 'select';
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: mocks.profile, error: null }),
        delete: () => {
          operation = 'delete';
          return query;
        },
        in: (_column: string, ids: number[]) => {
          mocks.deletedIds.push(ids);
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const result =
            table === 'profiles'
              ? { data: mocks.profile, error: null }
              : operation === 'delete'
                ? { data: null, error: mocks.deleteError }
                : { data: mocks.queued, error: mocks.queueError };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          expect(bucket).toBe('member-chat-images');
          mocks.removedPaths.push(paths);
          return { data: null, error: mocks.storageError };
        },
      }),
    },
  };
}

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.profile = { application_status: 'approved' };
  mocks.queued = [{ id: 1, image_path: 'member-1/old-image.png' }];
  mocks.queueError = null;
  mocks.storageError = null;
  mocks.deleteError = null;
  mocks.removedPaths = [];
  mocks.deletedIds = [];
  mocks.createClient.mockImplementation(serviceClient);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/member/chat/cleanup-images', () => {
  it('requires an authenticated approved member', async () => {
    mocks.user = null;
    expect((await POST()).status).toBe(401);
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'pending' };
    expect((await POST()).status).toBe(403);
  });

  it('removes queued private-storage objects before clearing their queue records', async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1 });
    expect(mocks.removedPaths).toEqual([['member-1/old-image.png']]);
    expect(mocks.deletedIds).toEqual([[1]]);
  });

  it('keeps queued records when storage deletion fails', async () => {
    mocks.storageError = { message: 'storage unavailable' };
    const response = await POST();
    expect(response.status).toBe(500);
    expect(mocks.deletedIds).toEqual([]);
  });

  it('handles empty queues, queue lookup errors, and queue clearing failures', async () => {
    mocks.queued = [];
    const empty = await POST();
    expect(await empty.json()).toEqual({ processed: 0 });
    expect(mocks.removedPaths).toEqual([]);

    mocks.queued = [{ id: 2, image_path: 'member-1/another.png' }];
    mocks.queueError = { message: 'queue unavailable' };
    const readError = await POST();
    expect(readError.status).toBe(500);
    expect(await readError.json()).toEqual({ error: 'Unable to load image cleanup queue.' });

    mocks.queueError = null;
    mocks.deleteError = { message: 'delete unavailable' };
    const deleteError = await POST();
    expect(deleteError.status).toBe(500);
    expect(await deleteError.json()).toEqual({
      error: 'Images were removed, but the cleanup queue could not be cleared.',
    });
    expect(mocks.removedPaths).toHaveLength(1);
  });

  it('returns the configuration error when service credentials are missing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const response = await POST();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Chat image cleanup is not configured.' });
  });
});
