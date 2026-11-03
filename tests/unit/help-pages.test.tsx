import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { role: string; application_status: string },
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : { club_name: 'Test Club', short_name: 'TC' },
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/club-display', () => ({
  getClubDisplay: () => ({ clubName: 'Test Club', shortName: 'TC', socialLinks: [] }),
}));
vi.mock('@/components/site-header', () => ({ SiteHeader: (props: unknown) => props }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: (props: unknown) => props }));
vi.mock('@/components/help-center', () => ({ HelpCenter: (props: unknown) => props }));
vi.mock('@/components/help-nav', () => ({ HelpNav: (props: unknown) => props }));

import HelpIndexPage from '@/app/help/page';
import AdminHelpPage from '@/app/help/admin/page';
import MemberHelpPage from '@/app/help/member/page';
import OrganizerHelpPage from '@/app/help/organizer/page';
import PublicHelpPage from '@/app/help/public/page';
import { HelpPage } from '@/components/help-page';

beforeEach(() => {
  mocks.user = null;
  mocks.profile = null;
  mocks.redirect.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('help pages', () => {
  it('redirects the help index to the public guide', async () => {
    expect(() => HelpIndexPage()).toThrow('redirect:/help/public');
  });

  it.each([
    [AdminHelpPage, 'admin'],
    [MemberHelpPage, 'member'],
    [OrganizerHelpPage, 'organizer'],
    [PublicHelpPage, 'public'],
  ])('routes the %s page to its guide', async (page, guide) => {
    const result = await page();
    expect(result).toMatchObject({ props: { guide } });
  });

  it('renders the public guide for anonymous visitors and hides staff navigation', async () => {
    const result = await HelpPage({ guide: 'public' });
    expect(result.props.children[1].props).toEqual({ role: null, approved: false });
    expect(result.props.children[2].props).toEqual({ guide: 'public' });
  });

  it('allows approved members their guide and redirects members away from staff guides', async () => {
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    const result = await HelpPage({ guide: 'member' });
    expect(result.props.children[1].props).toEqual({ role: 'member', approved: true });

    await expect(HelpPage({ guide: 'organizer' })).rejects.toThrow('redirect:/help/public');
  });

  it('allows an organizer guide and limits the admin guide to admins', async () => {
    mocks.user = { id: 'organizer-1' };
    mocks.profile = { role: 'organizer', application_status: 'approved' };
    expect(await HelpPage({ guide: 'organizer' })).toBeTruthy();
    await expect(HelpPage({ guide: 'admin' })).rejects.toThrow('redirect:/help/public');

    mocks.user = { id: 'admin-1' };
    mocks.profile = { role: 'admin', application_status: 'approved' };
    expect(await HelpPage({ guide: 'admin' })).toBeTruthy();
  });
});
