import { describe, expect, it } from 'vitest';
import { getPageTitle } from '@/components/page-title';

describe('page titles', () => {
  const title = (path: string) => getPageTitle(path, 'Configured Club');

  it('uses the configured short name for public pages', () => {
    expect(title('/events/summer-tournament')).toBe('Configured Club | Events');
    expect(title('/')).toBe('Configured Club | Home');
  });

  it('includes the portal for admin and member pages', () => {
    expect(title('/admin/events')).toBe('Configured Club | Admin | Events');
    expect(title('/member/profile')).toBe('Configured Club | Member | Profile');
  });

  it('maps named portal and authentication routes and title-cases other paths', () => {
    expect(title('/admin')).toBe('Configured Club | Admin | Dashboard');
    expect(title('/member/')).toBe('Configured Club | Member | Dashboard');
    expect(title('/admin/create')).toBe('Configured Club | Admin | Create Event');
    expect(title('/admin/membership-types')).toBe('Configured Club | Admin | Membership Types');
    expect(title('/admin/audit-logs')).toBe('Configured Club | Admin | Audit Logs');
    expect(title('/admin/club-profile')).toBe('Configured Club | Admin | Club Profile');
    expect(title('/forgot-password')).toBe('Configured Club | Forgot Password');
    expect(title('/reset-password')).toBe('Configured Club | Reset Password');
    expect(title('/member/custom-section/')).toBe('Configured Club | Member | Custom Section');
    expect(title('///')).toBe('Configured Club | Home');
  });
});
