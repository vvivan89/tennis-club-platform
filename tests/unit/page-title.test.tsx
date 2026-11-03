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

  it('maps named portal and authentication routes and title-cases other paths', () => {
    expect(getPageTitle('/admin')).toBe('PCTC | Admin | Dashboard');
    expect(getPageTitle('/member/')).toBe('PCTC | Member | Dashboard');
    expect(getPageTitle('/admin/create')).toBe('PCTC | Admin | Create Event');
    expect(getPageTitle('/admin/membership-types')).toBe('PCTC | Admin | Membership Types');
    expect(getPageTitle('/admin/audit-logs')).toBe('PCTC | Admin | Audit Logs');
    expect(getPageTitle('/admin/club-profile')).toBe('PCTC | Admin | Club Profile');
    expect(getPageTitle('/forgot-password')).toBe('PCTC | Forgot Password');
    expect(getPageTitle('/reset-password')).toBe('PCTC | Reset Password');
    expect(getPageTitle('/member/custom-section/')).toBe('PCTC | Member | Custom Section');
    expect(getPageTitle('///')).toBe('PCTC | Home');
  });
});
