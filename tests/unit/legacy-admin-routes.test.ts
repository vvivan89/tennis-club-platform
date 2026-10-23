import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import LegacyAdminTab from '@/app/admin/applications/page';
import LegacyAdminLegalPage from '@/app/admin/legal/page';

afterEach(() => vi.clearAllMocks());

describe('legacy administration routes', () => {
  it('redirects the former applications page to the membership tab', () => {
    expect(() => LegacyAdminTab()).toThrow('redirect:/admin/members?tab=applications');
  });

  it('moves legacy legal tabs to documents while preserving encoded query values', () => {
    expect(() => LegacyAdminLegalPage({ searchParams: { tab: ['terms of use'] } })).toThrow(
      'redirect:/admin/documents?tab=terms%20of%20use',
    );
    expect(() => LegacyAdminLegalPage({})).toThrow('redirect:/admin/documents');
  });
});
