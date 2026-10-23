import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  state: {
    signedIn: false,
    authReady: false,
    logoUrl: '',
    canSeeDocuments: false,
    canSeeRankings: false,
    name: '',
    avatar: '',
    isAdmin: false,
    isOrganizer: false,
    approved: false,
  },
  pathname: '/events/summer-open',
  rpc: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/components/site-header-state', () => ({ useSiteHeaderState: () => mocks.state }));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({ rpc: mocks.rpc, auth: { signOut: mocks.signOut } }),
}));

import { MemberMenu } from '@/components/member-menu';
import { SiteHeader } from '@/components/site-header';

beforeEach(() => {
  mocks.state = {
    signedIn: false,
    authReady: false,
    logoUrl: '',
    canSeeDocuments: false,
    canSeeRankings: false,
    name: '',
    avatar: '',
    isAdmin: false,
    isOrganizer: false,
    approved: false,
  };
  mocks.pathname = '/events/summer-open';
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('site navigation authorization and session actions', () => {
  it('shows a sign-in link while session is pending or user is unapproved', () => {
    const { unmount } = render(<MemberMenu />);
    expect(screen.getByRole('link', { name: /Checking session/ })).toHaveAttribute(
      'href',
      '/login',
    );
    unmount();
    mocks.state = { ...mocks.state, authReady: true, signedIn: true, approved: false };
    render(<MemberMenu />);
    expect(screen.getByRole('link', { name: 'Member sign in' })).toBeInTheDocument();
  });

  it('shows role-specific menu links and records/signs out in order', async () => {
    mocks.state = {
      ...mocks.state,
      signedIn: true,
      authReady: true,
      approved: true,
      name: 'Alex Admin',
      isAdmin: true,
      isOrganizer: true,
    };
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<MemberMenu />);
    expect(screen.getByText('AA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Member menu' }));
    expect(screen.getByRole('link', { name: 'Admin Portal' })).toHaveAttribute(
      'href',
      '/admin/dashboard',
    );
    expect(screen.getByRole('link', { name: 'Organizer Portal' })).toHaveAttribute(
      'href',
      '/admin/organizer-dashboard',
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mocks.rpc).toHaveBeenCalledWith(
      'record_client_audit_event',
      expect.objectContaining({ p_action: 'auth.sign_out' }),
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('exposes private navigation only when the access state allows it and marks current paths', () => {
    mocks.state = { ...mocks.state, canSeeDocuments: false, canSeeRankings: false, logoUrl: '' };
    const { unmount } = render(<SiteHeader clubName="Club" shortName="C" active="" />);
    expect(
      screen
        .getAllByRole('link', { name: 'Events' })
        .some((link) => link.getAttribute('aria-current') === 'page'),
    ).toBe(true);
    expect(screen.queryByRole('link', { name: 'Documents' })).not.toBeInTheDocument();
    unmount();
    mocks.state = {
      ...mocks.state,
      canSeeDocuments: true,
      canSeeRankings: true,
      logoUrl: '/logo.svg',
    };
    render(<SiteHeader clubName="Club" shortName="C" active="" />);
    expect(screen.getAllByRole('link', { name: 'Documents' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Rankings' })).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Club logo' })).toHaveAttribute('src', '/logo.svg');
  });
});
