import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { isCronAuthorized, matchesBearerSecret } from '@/lib/api-helpers';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getSiteOrigin } from '@/lib/site-url';

const request = (headers: Record<string, string> = {}, url = 'https://internal.example/api/x') =>
  new Request(url, { headers });

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('enforceRateLimit', () => {
  const options = { name: 'checkout', limit: 5, windowSeconds: 600 };

  it('allows requests under the limit and keys guests by forwarded IP', async () => {
    expect(
      await enforceRateLimit(request({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), options),
    ).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith('check_rate_limit', {
      p_key: 'checkout:ip:203.0.113.7',
      p_limit: 5,
      p_window_seconds: 600,
    });
  });

  it('keys signed-in callers by user id', async () => {
    await enforceRateLimit(request({ 'x-forwarded-for': '203.0.113.7' }), {
      ...options,
      userId: 'user-1',
    });
    expect(mocks.rpc.mock.calls[0][1].p_key).toBe('checkout:user:user-1');
  });

  it('returns 429 with Retry-After when the counter says the limit is exceeded', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await enforceRateLimit(request(), options);
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('600');
    expect((await response!.json()).error).toMatch(/too many requests/i);
  });

  it('fails open when the counter errors, throws, or Supabase is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'function missing' } });
    expect(await enforceRateLimit(request(), options)).toBeNull();
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await enforceRateLimit(request(), options)).toBeNull();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    mocks.rpc.mockClear();
    expect(await enforceRateLimit(request(), options)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('cron authorization', () => {
  it('accepts only the exact bearer secret', () => {
    vi.stubEnv('CRON_SECRET', 'cron-key');
    expect(isCronAuthorized(request({ authorization: 'Bearer cron-key' }))).toBe(true);
    expect(isCronAuthorized(request({ authorization: 'Bearer cron-kez' }))).toBe(false);
    expect(isCronAuthorized(request({ authorization: 'cron-key' }))).toBe(false);
    expect(isCronAuthorized(request())).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(matchesBearerSecret('Bearer ', '')).toBe(false);
    expect(isCronAuthorized(request({ authorization: 'Bearer undefined' }))).toBe(false);
  });
});

describe('getSiteOrigin', () => {
  it('prefers the configured site URL over the request host', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://club.example/some/path');
    expect(getSiteOrigin(request({ host: 'evil.example' }))).toBe('https://club.example');
  });

  it('falls back to the request origin when unset or invalid', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(getSiteOrigin(request())).toBe('https://internal.example');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not a url');
    expect(getSiteOrigin(request())).toBe('https://internal.example');
  });
});
