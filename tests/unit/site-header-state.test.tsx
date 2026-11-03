import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1', email: 'member@example.com' } as null | { id: string; email?: string },
  logoUrl: '/club.svg' as string | null,
  profile: {
    full_name: 'Member One',
    avatar_url: null,
    role: 'member',
    application_status: 'approved',
  } as Record<string, unknown> | null,
  paid: false,
  family: null as null | {
    membership_families: { paid_at: string | null } | { paid_at: string | null }[];
  },
  getUserReject: false,
  authListener: null as
    null | ((event: string, session: { user: { id: string; email?: string } } | null) => void),
  unsubscribe: vi.fn(),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getUser: async () => {
        if (mocks.getUserReject) throw new Error('session unavailable');
        return { data: { user: mocks.user } };
      },
      onAuthStateChange: (callback: typeof mocks.authListener) => {
        mocks.authListener = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
    rpc: async () => ({ data: mocks.paid, error: null }),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data:
            table === 'club_settings'
              ? { logo_url: mocks.logoUrl }
              : table === 'profiles'
                ? mocks.profile
                : mocks.family,
          error: null,
        }),
      };
      return query;
    },
  }),
}));

import { SiteHeaderStateProvider, useSiteHeaderState } from '@/components/site-header-state';

function StateOutput() {
  const state = useSiteHeaderState();
  return <output data-testid="state">{JSON.stringify(state)}</output>;
}
function getState() {
  return JSON.parse(screen.getByTestId('state').textContent || '{}');
}

beforeEach(() => {
  mocks.user = { id: 'member-1', email: 'member@example.com' };
  mocks.logoUrl = '/club.svg';
  mocks.profile = {
    full_name: 'Member One',
    avatar_url: null,
    role: 'member',
    application_status: 'approved',
  };
  mocks.paid = false;
  mocks.family = null;
  mocks.getUserReject = false;
  mocks.authListener = null;
  mocks.unsubscribe.mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SiteHeaderStateProvider', () => {
  it('keeps rankings and documents hidden from approved but never-paid members', async () => {
    render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().authReady).toBe(true));
    expect(getState()).toMatchObject({
      signedIn: true,
      approved: true,
      name: 'Member One',
      canSeeDocuments: false,
      canSeeRankings: false,
    });
  });

  it('enables paid-family access and uses profile display data', async () => {
    mocks.family = { membership_families: { paid_at: '2025-01-01' } };
    render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().canSeeDocuments).toBe(true));
    expect(getState()).toMatchObject({ canSeeRankings: true, avatar: '', logoUrl: '/club.svg' });
  });

  it('grants approved admins access without a payment and marks their role', async () => {
    mocks.profile = {
      full_name: 'Club Admin',
      avatar_url: '/admin.jpg',
      role: 'admin',
      application_status: 'approved',
    };
    mocks.paid = true;
    render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().isAdmin).toBe(true));
    expect(getState()).toMatchObject({
      canSeeDocuments: true,
      canSeeRankings: true,
      isOrganizer: false,
    });
  });

  it('clears member access when the auth listener reports sign-out and unsubscribes on unmount', async () => {
    const { unmount } = render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().authReady).toBe(true));
    mocks.authListener?.('SIGNED_OUT', null);
    await waitFor(() =>
      expect(getState()).toMatchObject({
        signedIn: false,
        canSeeDocuments: false,
        canSeeRankings: false,
      }),
    );
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses the family relation array shape and skips the family lookup when the payment RPC succeeds', async () => {
    mocks.paid = true;
    mocks.family = { membership_families: [{ paid_at: null }] };
    render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().canSeeRankings).toBe(true));
    expect(getState().approved).toBe(true);
  });

  it('uses the email prefix when profile details are missing and reacts to guest sign-in', async () => {
    mocks.profile = null;
    render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().name).toBe('member'));
    mocks.authListener?.('SIGNED_IN', {
      user: { id: 'guest-1', email: 'guest@example.test' },
    });
    await waitFor(() =>
      expect(getState()).toMatchObject({
        signedIn: true,
        name: 'guest',
        isEventGuest: false,
        approved: false,
        canSeeDocuments: false,
      }),
    );
  });

  it('marks an event-only account and handles an initial auth lookup rejection', async () => {
    mocks.profile = {
      full_name: '',
      avatar_url: '',
      role: 'member',
      application_status: 'approved',
      account_kind: 'event_guest',
    };
    const { unmount } = render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().isEventGuest).toBe(true));
    expect(getState().name).toBe('member');
    unmount();

    mocks.getUserReject = true;
    render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().authReady).toBe(true));
    expect(getState().signedIn).toBe(false);
  });

  it('keeps an empty logo when none is configured and applies organizer auth and logo updates', async () => {
    mocks.logoUrl = null;
    mocks.user = null;
    const { unmount } = render(
      <SiteHeaderStateProvider>
        <StateOutput />
      </SiteHeaderStateProvider>,
    );
    await waitFor(() => expect(getState().authReady).toBe(true));
    expect(getState()).toMatchObject({ signedIn: false, logoUrl: '', isOrganizer: false });

    mocks.profile = {
      full_name: null,
      avatar_url: null,
      role: 'organizer',
      application_status: 'approved',
    };
    mocks.paid = true;
    mocks.logoUrl = '/updated.svg';
    window.dispatchEvent(new Event('club-logo-updated'));
    mocks.authListener?.('SIGNED_IN', { user: { id: 'organizer-1', email: 'coach@example.test' } });
    await waitFor(() =>
      expect(getState()).toMatchObject({
        signedIn: true,
        name: 'coach',
        isOrganizer: true,
        isAdmin: false,
        logoUrl: '/updated.svg',
        canSeeDocuments: true,
      }),
    );
    unmount();
  });
});
