import { describe, expect, it } from 'vitest';
import { canAccessHelpGuide } from '@/lib/help-access';

describe('Help guide route access', () => {
  it('allows the public page to everyone and gates role pages', () => {
    expect(canAccessHelpGuide('public', null, false)).toBe(true);
    expect(canAccessHelpGuide('member', 'member', false)).toBe(false);
    expect(canAccessHelpGuide('member', 'member', true)).toBe(true);
    expect(canAccessHelpGuide('organizer', 'member', true)).toBe(false);
    expect(canAccessHelpGuide('organizer', 'organizer', false)).toBe(true);
    expect(canAccessHelpGuide('organizer', 'admin', false)).toBe(true);
    expect(canAccessHelpGuide('admin', 'organizer', true)).toBe(false);
    expect(canAccessHelpGuide('admin', 'admin', true)).toBe(true);
  });
});
