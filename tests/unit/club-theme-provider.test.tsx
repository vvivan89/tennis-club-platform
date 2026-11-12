import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  authListener: null as unknown,
  profileByUser: {} as Record<string, { theme_mode: string; theme_accent: string }>,
  maybeSingle: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('next-themes', async () => {
  const React = await import('react');
  const ThemeContext = React.createContext<{
    theme: string;
    setTheme: (theme: string) => void;
  } | null>(null);

  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => {
      const [theme, setTheme] = React.useState('system');
      return React.createElement(ThemeContext.Provider, { value: { theme, setTheme } }, children);
    },
    useTheme: () => {
      const value = React.useContext(ThemeContext);
      if (!value) throw new Error('Missing test theme provider.');
      return value;
    },
  };
});

vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => {
    const query = {
      select: () => query,
      eq: (_column: string, userId: string) => {
        mocks.maybeSingle.mockImplementation(async () => ({
          data: mocks.profileByUser[userId] ?? null,
          error: null,
        }));
        return query;
      },
      maybeSingle: () => mocks.maybeSingle(),
    };
    return {
      auth: {
        getUser: mocks.getUser,
        onAuthStateChange: (callback: unknown) => {
          mocks.authListener = callback;
          return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
        },
      },
      from: () => query,
    };
  },
}));

import { ClubThemeProvider, useClubTheme } from '@/components/club-theme-provider';

function ThemeProbe() {
  const { mode, preferencesReady, setMode } = useClubTheme();
  return (
    <>
      <p data-testid="theme-state">{mode}</p>
      <p data-testid="preference-state">{preferencesReady ? 'ready' : 'loading'}</p>
      <button type="button" onClick={() => setMode('dark')}>
        Preview dark
      </button>
    </>
  );
}

function getAuthListener() {
  return mocks.authListener as
    ((event: string, session: { user?: { id: string } } | null) => void) | null;
}

beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.authListener = null;
  mocks.profileByUser = {
    'user-1': { theme_mode: 'system', theme_accent: 'green' },
    'user-2': { theme_mode: 'light', theme_accent: 'orange' },
  };
  mocks.maybeSingle.mockReset();
  mocks.unsubscribe.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClubThemeProvider', () => {
  it('does not overwrite a theme preview when Supabase refreshes the same user token', async () => {
    render(
      <ClubThemeProvider>
        <ThemeProbe />
      </ClubThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('preference-state')).toHaveTextContent('ready'));
    expect(screen.getByTestId('theme-state')).toHaveTextContent('system');

    fireEvent.click(screen.getByRole('button', { name: 'Preview dark' }));
    expect(screen.getByTestId('theme-state')).toHaveTextContent('dark');

    getAuthListener()?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
    await waitFor(() => expect(mocks.maybeSingle).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('theme-state')).toHaveTextContent('dark');
  });

  it('reloads preferences when the signed-in user changes', async () => {
    render(
      <ClubThemeProvider>
        <ThemeProbe />
      </ClubThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('preference-state')).toHaveTextContent('ready'));

    getAuthListener()?.('SIGNED_OUT', null);
    getAuthListener()?.('SIGNED_IN', { user: { id: 'user-2' } });

    await waitFor(() => expect(screen.getByTestId('theme-state')).toHaveTextContent('light'));
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2);
  });
});
