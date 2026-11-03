import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string },
}));

vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mocks.profile }) }),
      }),
    }),
  }),
}));

import { getAdminBrowserClient, requireBrowserUser } from '@/lib/supabase-browser-user';

afterEach(() => {
  mocks.user = null;
  mocks.profile = null;
  vi.restoreAllMocks();
});

describe('browser user helpers', () => {
  it('requires an authenticated user and preserves a caller-provided message', async () => {
    await expect(requireBrowserUser()).rejects.toThrow('Sign in again.');
    await expect(requireBrowserUser('Please sign in.')).rejects.toThrow('Please sign in.');
    mocks.user = { id: 'member-1' };
    await expect(requireBrowserUser()).resolves.toMatchObject({ user: { id: 'member-1' } });
  });

  it('redirects signed-out and non-admin users, and returns the client for an admin', async () => {
    const router = { replace: vi.fn() };
    expect(await getAdminBrowserClient(router, '/login?next=/admin')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/login?next=/admin');

    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'organizer' };
    expect(await getAdminBrowserClient(router, '/login')).toBeNull();
    expect(router.replace).toHaveBeenLastCalledWith('/member/dashboard');

    mocks.profile = { role: 'admin' };
    expect(await getAdminBrowserClient(router, '/login')).toBeTruthy();
  });
});
