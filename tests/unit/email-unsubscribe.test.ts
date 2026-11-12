import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createEmailUnsubscribeUrl } from '@/lib/email-unsubscribe';

describe('createEmailUnsubscribeUrl', () => {
  it('stores only a hash and returns an opaque token on the request host', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn(() => ({ insert })) };

    const url = new URL(
      await createEmailUnsubscribeUrl(
        db as never,
        new Request('https://demo.example.test/api/send'),
        'user-1',
        'newsletter',
      ),
    );
    const token = url.searchParams.get('token')!;
    const inserted = insert.mock.calls[0][0];

    expect(url.origin).toBe('https://demo.example.test');
    expect(url.pathname).toBe('/email-preferences/unsubscribe');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inserted).toMatchObject({
      user_id: 'user-1',
      email_type: 'newsletter',
      token_hash: createHash('sha256').update(token).digest('hex'),
    });
    expect(inserted.token_hash).not.toBe(token);
    expect(inserted.expires_at).toBeTruthy();
  });

  it('does not return a link if the token record could not be stored', async () => {
    const db = {
      from: () => ({ insert: async () => ({ error: new Error('database unavailable') }) }),
    };

    await expect(
      createEmailUnsubscribeUrl(
        db as never,
        new Request('https://demo.example.test/api/send'),
        'user-1',
        'newsletter',
      ),
    ).rejects.toThrow('Could not prepare the email unsubscribe link.');
  });
});
