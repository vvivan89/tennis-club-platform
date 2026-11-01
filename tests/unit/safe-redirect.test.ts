import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '@/lib/safe-redirect';

describe('safeRedirectPath', () => {
  it('keeps same-origin relative paths with query strings', () => {
    expect(safeRedirectPath('/admin/events?tab=past#top', '/home')).toBe(
      '/admin/events?tab=past#top',
    );
  });

  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    'javascript:alert(1)',
    'evil.com',
    '/path\nwith-newline',
    '',
    null,
    undefined,
  ])('falls back for %s', (value) => {
    expect(safeRedirectPath(value, '/home')).toBe('/home');
  });
});
