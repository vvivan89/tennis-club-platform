import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import { MobileNavigationDrawer } from '@/components/mobile-navigation-drawer';
import { Home } from 'lucide-react';

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
  it('opens a compact public drawer with main links and login for signed-out visitors', async () => {
    const user = userEvent.setup();
    render(
      <MobileNavigationDrawer
        mainLinks={[
          { href: '/', label: 'Home', icon: <Home aria-hidden="true" />, current: false },
          { href: '/events', label: 'Events', icon: <Home aria-hidden="true" />, current: true },
        ]}
        signedIn={false}
        avatar=""
        initials=""
        name=""
        approved={false}
        isAdmin={false}
        isOrganizer={false}
        isEventGuest={false}
        onSignOut={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open public menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('mobile-navigation-panel');
    expect(dialog.parentElement).toHaveClass('mobile-navigation-backdrop');
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Main menu' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    const login = screen.getByRole('link', { name: 'Log in' });
    const mainLink = screen.getByRole('link', { name: 'Home' });
    expect(login.compareDocumentPosition(mainLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows only the current portal section expanded and highlights its active item', async () => {
    mocks.pathname = '/admin/members?tab=applications';
    const user = userEvent.setup();
    render(
      <MobileNavigationDrawer
        mainLinks={[
          { href: '/', label: 'Home', icon: <Home aria-hidden="true" />, current: false },
        ]}
        signedIn
        avatar=""
        initials="AA"
        name="Alex Admin"
        approved
        isAdmin
        isOrganizer={false}
        isEventGuest={false}
        onSignOut={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('heading', { name: 'Alex Admin' })).toBeInTheDocument();
    expect(screen.queryByText('Signed in as Alex Admin')).not.toBeInTheDocument();
    const adminPortal = screen.getByRole('button', { name: 'Admin Portal' });
    expect(adminPortal.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin Portal' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Member Portal' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Membership' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Main menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('shows sign-in while session is pending and hides member links for unapproved users', async () => {
    const { unmount } = render(<MemberMenu />);
    expect(screen.getByRole('link', { name: /Checking session/ })).toHaveAttribute(
      'href',
      '/login',
    );
    unmount();
    mocks.state = { ...mocks.state, authReady: true, signedIn: true, approved: false };
    render(<MemberMenu />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Member menu' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Member Portal' })).not.toBeInTheDocument();
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
    expect(screen.getAllByText('AA')).toHaveLength(2);
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

  it('keeps portal links open when focus moves from the trigger into the menu', async () => {
    mocks.state = {
      ...mocks.state,
      signedIn: true,
      authReady: true,
      approved: true,
      isAdmin: true,
    };
    render(<MemberMenu />);
    const trigger = screen.getByRole('button', { name: 'Member menu' });
    fireEvent.click(trigger);
    const adminLink = screen.getByRole('link', { name: 'Admin Portal' });

    fireEvent.blur(trigger, { relatedTarget: adminLink });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(screen.getByRole('link', { name: 'Admin Portal' })).toBeInTheDocument();
  });

  it('exposes private navigation only when the access state allows it and marks current paths', () => {
    mocks.state = { ...mocks.state, canSeeDocuments: false, canSeeRankings: false, logoUrl: '' };
    const { unmount, container } = render(<SiteHeader clubName="Club" shortName="C" active="" />);
    expect(container.querySelector('.page-container')).toHaveClass(
      'flex',
      'items-center',
      'justify-between',
    );
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
    expect(screen.getAllByRole('link', { name: 'Documents' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Rankings' })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Club logo' })).toHaveAttribute('src', '/logo.svg');
  });

  it('shows Help as a direct top-level link, without a dropdown', () => {
    render(<SiteHeader clubName="Club" shortName="C" active="" />);
    expect(screen.getAllByRole('link', { name: 'Help' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Help' })[0]).toHaveAttribute(
      'href',
      '/help/public',
    );
    expect(screen.queryByText('Help home')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin guide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Organizer guide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Member guide' })).not.toBeInTheDocument();
  });

  it('keeps role guide links out of the top navigation', () => {
    mocks.state = { ...mocks.state, approved: true, isOrganizer: true };
    render(<SiteHeader clubName="Club" shortName="C" active="" />);
    expect(screen.getAllByRole('link', { name: 'Help' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Organizer guide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Member guide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin guide' })).not.toBeInTheDocument();
  });
});
