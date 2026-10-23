import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import AdminRootRedirect from '@/app/admin/page';
import DashboardRedirect from '@/app/dashboard/page';
import ProfileRedirect from '@/app/profile/page';
import MembershipRedirect from '@/app/membership/page';
import MemberStatsRedirect from '@/app/member/stats/page';
import StatsRedirect from '@/app/stats/page';
import AdminGalleryRedirect from '@/app/admin/gallery/page';
import MembershipTypesRedirect from '@/app/admin/membership-types/page';

beforeEach(() => mocks.redirect.mockClear());

describe('legacy route redirects', () => {
  it('redirects each legacy path to its canonical destination', () => {
    const routes: Array<[() => unknown, string]> = [
      [AdminRootRedirect, '/admin/dashboard'],
      [DashboardRedirect, '/member/dashboard'],
      [ProfileRedirect, '/member/profile'],
      [MembershipRedirect, '/member/membership'],
      [MemberStatsRedirect, '/member/results'],
      [StatsRedirect, '/member/results'],
      [AdminGalleryRedirect, '/admin/website?tab=gallery'],
      [MembershipTypesRedirect, '/admin/members?tab=membership-types'],
    ];
    for (const [page, destination] of routes) {
      page();
      expect(mocks.redirect).toHaveBeenCalledWith(destination);
      mocks.redirect.mockClear();
    }
  });
});
