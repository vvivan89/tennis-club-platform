import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: mocks.createBrowserClient,
  createServerClient: mocks.createServerClient,
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Supabase client factories', () => {
  it('requires public URL and a browser-safe key for browser clients', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(() => createSupabaseBrowserClient()).toThrow('Supabase is not configured');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable');
    expect(createSupabaseBrowserClient()).toBeUndefined();
    expect(mocks.createBrowserClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'publishable',
    );
  });

  it('falls back to the anon key when the publishable key is absent', () => {
    const originalPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    try {
      createSupabaseBrowserClient();
      expect(mocks.createBrowserClient).toHaveBeenCalledWith(
        'https://example.supabase.co',
        'anon-key',
      );
    } finally {
      if (originalPublishableKey === undefined)
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    }
  });

  it('passes cookie reads and writes through the server factory', async () => {
    const set = vi.fn();
    const store = { getAll: vi.fn(() => [{ name: 'session', value: 'cookie' }]), set };
    mocks.cookies.mockReturnValue(store);
    mocks.createServerClient.mockImplementation((_url, _key, options) => options);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable');

    const client = (await createSupabaseServerClient()) as unknown as {
      cookies: {
        getAll: () => unknown[];
        setAll: (cookies: Array<{ name: string; value: string; options?: unknown }>) => void;
      };
    };
    expect(client.cookies.getAll()).toEqual([{ name: 'session', value: 'cookie' }]);
    client.cookies.setAll([{ name: 'new-session', value: 'new-value', options: { path: '/' } }]);
    expect(set).toHaveBeenCalledWith('new-session', 'new-value', { path: '/' });
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'publishable',
      expect.any(Object),
    );
  });

  it('suppresses cookie writes that are unavailable in server components', async () => {
    mocks.cookies.mockReturnValue({
      getAll: () => [],
      set: () => {
        throw new Error('read-only cookie store');
      },
    });
    mocks.createServerClient.mockImplementation((_url, _key, options) => options);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    const client = (await createSupabaseServerClient()) as unknown as {
      cookies: {
        setAll: (cookies: Array<{ name: string; value: string; options?: unknown }>) => void;
      };
    };
    expect(() => client.cookies.setAll([{ name: 'session', value: 'x' }])).not.toThrow();
  });

  it('keeps the compatibility wrapper delegated to the browser factory', () => {
    const browserClient = { from: vi.fn() };
    mocks.createBrowserClient.mockReturnValue(browserClient);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable');
    expect(getSupabase()).toBe(browserClient);
  });
});
