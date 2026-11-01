import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@/lib/sanitize-html';

describe('sanitizeHtml', () => {
  it('keeps rich-text formatting', () => {
    expect(
      sanitizeHtml(
        '<h2>Rules</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>',
      ),
    ).toBe('<h2>Rules</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>');
  });

  it.each([
    ['<img src=x onerror=alert(1)>', ''],
    ['<svg/onload=alert(1)>', ''],
    ['<p onclick="x()">Hi</p>', '<p>Hi</p>'],
    ['<script>alert(1)</script><p>Hi</p>', '<p>Hi</p>'],
    ['<iframe src="https://evil.com"></iframe>', ''],
    ['<p style="x:expression(alert(1))">Hi</p>', '<p>Hi</p>'],
  ])('strips active content from %s', (input, expected) => {
    expect(sanitizeHtml(input)).toBe(expected);
  });

  it('removes dangerous link schemes and hardens safe links', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(sanitizeHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer nofollow">x</a>',
    );
  });

  it('handles empty input', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });
});
