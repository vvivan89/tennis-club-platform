import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchangeError: null as null | { message: string },
  signOut: vi.fn(),
  createServerClient: vi.fn(),
  cookieWrites: [] as unknown[][],
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [{ name: 'session', value: 'cookie-value' }],
    set: (...args: unknown[]) => {
      mocks.cookieWrites.push(args);
    },
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => {
    mocks.createServerClient(...args);
    return {
      auth: {
        exchangeCodeForSession: async () => ({ error: mocks.exchangeError }),
        signOut: mocks.signOut,
      },
    };
  },
}));

import { GET as callbackGet } from '@/app/auth/callback/route';
import { POST as signoutPost } from '@/app/auth/signout/route';

beforeEach(() => {
  mocks.exchangeError = null;
  mocks.signOut.mockReset();
  mocks.createServerClient.mockClear();
  mocks.cookieWrites = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function callback(url: string) {
  return new Request(url);
}

describe('authentication routes', () => {
  it('uses the callback confirmation path when there is no code or exchange fails', async () => {
    const missing = await callbackGet(callback('https://club.example/auth/callback'));
    expect(missing.headers.get('location')).toBe(
      'https://club.example/auth/guest-callback?next=%2Fmember%2Fdashboard',
    );

    mocks.exchangeError = { message: 'invalid code' };
    const failed = await callbackGet(callback('https://club.example/auth/callback?code=bad'));
    expect(failed.headers.get('location')).toBe('https://club.example/login?error=confirmation');
  });

  it('redirects successful exchanges to safe relative paths and rejects protocol-relative paths', async () => {
    const valid = await callbackGet(
      callback('https://club.example/auth/callback?code=good&next=%2Fmember%2Fprofile'),
    );
    expect(valid.headers.get('location')).toBe('https://club.example/member/profile');
    const unsafe = await callbackGet(
      callback('https://club.example/auth/callback?code=good&next=%2F%2Fevil.example'),
    );
    expect(unsafe.headers.get('location')).toBe('https://club.example/member/dashboard');
  });

  it('reports callback configuration errors and applies session cookies', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const missingConfig = await callbackGet(
      callback('https://club.example/auth/callback?code=good'),
    );
    expect(missingConfig.headers.get('location')).toBe(
      'https://club.example/login?error=configuration',
    );

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    mocks.createServerClient.mockImplementationOnce(
      (
        _url: unknown,
        _key: unknown,
        options: {
          cookies: {
            getAll: () => unknown;
            setAll: (cookies: Array<{ name: string; value: string; options?: unknown }>) => void;
          };
        },
      ) => {
        expect(options.cookies.getAll()).toEqual([{ name: 'session', value: 'cookie-value' }]);
        options.cookies.setAll([{ name: 'refreshed', value: 'new-value', options: { path: '/' } }]);
        return { auth: { exchangeCodeForSession: async () => ({ error: null }) } };
      },
    );
    await callbackGet(callback('https://club.example/auth/callback?code=good'));
    expect(mocks.cookieWrites).toEqual([['refreshed', 'new-value', { path: '/' }]]);
  });

  it('always redirects signout to the site root and signs out when configured', async () => {
    mocks.createServerClient.mockImplementationOnce(
      (
        _url: unknown,
        _key: unknown,
        options: {
          cookies: {
            getAll: () => unknown;
            setAll: (cookies: Array<{ name: string; value: string; options?: unknown }>) => void;
          };
        },
      ) => {
        expect(options.cookies.getAll()).toEqual([{ name: 'session', value: 'cookie-value' }]);
        options.cookies.setAll([{ name: 'signed-out', value: 'cleared', options: { path: '/' } }]);
        return { auth: { signOut: mocks.signOut } };
      },
    );
    const response = await signoutPost(
      new Request('https://club.example/auth/signout', { method: 'POST' }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://club.example/');
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.cookieWrites).toEqual([['signed-out', 'cleared', { path: '/' }]]);

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const noConfig = await signoutPost(
      new Request('https://club.example/auth/signout', { method: 'POST' }),
    );
    expect(noConfig.status).toBe(303);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
