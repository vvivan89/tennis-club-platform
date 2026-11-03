import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refresh: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/browser-navigation', () => ({
  navigateToPath: mocks.navigate,
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { setSession: mocks.setSession, getSession: mocks.getSession },
  }),
}));

import GuestAuthCallbackPage from '@/app/auth/guest-callback/page';

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.refresh.mockReset();
  mocks.setSession
    .mockReset()
    .mockResolvedValue({ data: { session: { user: { id: 'guest-1' } } }, error: null });
  mocks.getSession
    .mockReset()
    .mockResolvedValue({ data: { session: { user: { id: 'guest-1' } } }, error: null });
  setUrl('/auth/guest-callback?next=%2Fevents%2Fsummer#access_token=access&refresh_token=refresh');
});
afterEach(() => {
  cleanup();
  setUrl('/');
});

describe('guest auth callback page', () => {
  it('sets the session from the one-time link and safely continues to the event', async () => {
    render(<GuestAuthCallbackPage />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/events/summer'));
    expect(mocks.setSession).toHaveBeenCalledWith({
      access_token: 'access',
      refresh_token: 'refresh',
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('uses an existing session when the link has no tokens', async () => {
    setUrl('/auth/guest-callback?next=%2Fmy-events');
    render(<GuestAuthCallbackPage />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/my-events'));
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it('shows link errors and does not redirect', async () => {
    setUrl('/auth/guest-callback?next=%2Fevents#access_token=bad&error_description=link+expired');
    render(<GuestAuthCallbackPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('link expired');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events');
  });

  it('reports invalid, expired, and failed sessions and rejects unsafe redirects', async () => {
    setUrl('/auth/guest-callback?next=https%3A%2F%2Fevil.example');
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<GuestAuthCallbackPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(mocks.navigate).not.toHaveBeenCalled();

    cleanup();
    setUrl('/auth/guest-callback?next=%2Fmember#access_token=bad&refresh_token=bad');
    mocks.setSession.mockResolvedValue({
      data: { session: null },
      error: new Error('session rejected'),
    });
    render(<GuestAuthCallbackPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('session rejected');
  });
});
