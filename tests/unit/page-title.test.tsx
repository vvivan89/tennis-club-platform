import { describe, expect, it } from 'vitest';
import { getPageTitle } from '@/components/page-title';

describe('page titles', () => {
  it('uses the PCTC prefix for public pages', () => {
    expect(getPageTitle('/events/summer-tournament')).toBe('PCTC | Events');
    expect(getPageTitle('/')).toBe('PCTC | Home');
  });

  it('includes the portal for admin and member pages', () => {
    expect(getPageTitle('/admin/events')).toBe('PCTC | Admin | Events');
    expect(getPageTitle('/member/profile')).toBe('PCTC | Member | Profile');
  });
});
