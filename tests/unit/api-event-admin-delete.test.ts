import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string },
  event: null as null | {
    id: string;
    starts_at: string;
    created_by: string;
    organizer_id: string | null;
  },
  deleteError: null as null | { message: string },
  deleteCalls: 0,
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      let deleting = false;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : mocks.event,
          error: null,
        }),
        delete: () => {
          deleting = true;
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve().then(() => {
            if (deleting) mocks.deleteCalls += 1;
            return resolve({ data: null, error: mocks.deleteError });
          }, reject),
      };
      return query;
    },
  }),
}));

import { DELETE } from '@/app/api/admin/events/[eventId]/delete/route';

function remove(eventId = 'event-1') {
  return DELETE(new Request('https://club.test'), { params: Promise.resolve({ eventId }) });
}

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin' };
  mocks.event = {
    id: 'event-1',
    starts_at: '2099-01-01T12:00:00Z',
    created_by: 'admin-1',
    organizer_id: null,
  };
  mocks.deleteError = null;
  mocks.deleteCalls = 0;
});
afterEach(() => vi.clearAllMocks());

describe('DELETE /api/admin/events/[eventId]/delete', () => {
  it('requires an authenticated manager and an existing event', async () => {
    mocks.user = null;
    expect((await remove()).status).toBe(401);
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member' };
    expect((await remove()).status).toBe(403);
    mocks.profile = { role: 'admin' };
    mocks.event = null;
    expect((await remove()).status).toBe(404);
    expect(mocks.deleteCalls).toBe(0);
  });

  it('only permits future events and restricts organizers to their own events', async () => {
    mocks.event = { ...mocks.event!, starts_at: '2000-01-01T12:00:00Z' };
    expect((await remove()).status).toBe(400);
    mocks.profile = { role: 'organizer' };
    mocks.event = {
      ...mocks.event!,
      starts_at: '2099-01-01T12:00:00Z',
      created_by: 'someone-else',
    };
    expect((await remove()).status).toBe(403);
    mocks.event = { ...mocks.event!, organizer_id: 'admin-1' };
    expect((await remove()).status).toBe(200);
    expect(mocks.deleteCalls).toBe(1);
  });

  it('deletes an admin event and returns database failures safely', async () => {
    expect(await (await remove()).json()).toEqual({ success: true });
    mocks.deleteError = { message: 'database unavailable' };
    const failed = await remove();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'database unavailable' });
  });
});
