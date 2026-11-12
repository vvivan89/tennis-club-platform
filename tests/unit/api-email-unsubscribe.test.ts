import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase-service', () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.rateLimit }));

import { POST } from '@/app/api/email-preferences/unsubscribe/route';

afterEach(() => vi.clearAllMocks());

describe('POST /api/email-preferences/unsubscribe', () => {
  it('hashes the submitted token and applies the matching preference', async () => {
    const token = 'a'.repeat(43);
    mocks.rateLimit.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({
      data: [{ outcome: 'unsubscribed', email_type: 'newsletter' }],
      error: null,
    });

    const response = await POST(
      new Request('https://club.example/api/email-preferences/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      emailType: 'newsletter',
      label: 'newsletter and club news',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('apply_email_unsubscribe', {
      p_token_hash: createHash('sha256').update(token).digest('hex'),
    });
  });

  it('does not call the database for malformed tokens', async () => {
    mocks.rateLimit.mockResolvedValue(null);
    const response = await POST(
      new Request('https://club.example/api/email-preferences/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-token' }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('honors the request rate limit before processing tokens', async () => {
    const limitedResponse = Response.json({ error: 'Too many requests.' }, { status: 429 });
    mocks.rateLimit.mockResolvedValue(limitedResponse);
    const response = await POST(
      new Request('https://club.example/api/email-preferences/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'a'.repeat(43) }),
      }),
    );

    expect(response).toBe(limitedResponse);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
