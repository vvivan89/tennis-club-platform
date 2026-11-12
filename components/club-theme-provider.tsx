'use client';

import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export type ClubThemeMode = 'light' | 'dark' | 'system';
export type ClubAccentColor = 'blue' | 'green' | 'orange';

type ClubThemeContextValue = {
  mode: ClubThemeMode;
  accentColor: ClubAccentColor;
  preferencesReady: boolean;
  setMode: (mode: ClubThemeMode) => void;
  setAccentColor: (color: ClubAccentColor) => void;
};

type CachedPreferences = { mode?: unknown; accentColor?: unknown };
const STORAGE_KEY = 'club-theme-preferences';
const ClubThemeContext = createContext<ClubThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ClubThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isAccentColor(value: unknown): value is ClubAccentColor {
  return value === 'blue' || value === 'green' || value === 'orange';
}

function readCachedPreferences(): CachedPreferences | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as CachedPreferences) : null;
  } catch {
    return null;
  }
}

function writeCachedPreferences(mode: ClubThemeMode, accentColor: ClubAccentColor) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, accentColor }));
  } catch {
    // Theme changes still apply for this page if storage is unavailable.
  }
}

function SyncedClubThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [accentColor, setAccentColorState] = useState<ClubAccentColor>('green');
  const [preferencesReady, setPreferencesReady] = useState(false);
  const generation = useRef(0);
  const mode: ClubThemeMode = isThemeMode(theme) ? theme : 'system';

  useEffect(() => {
    const cached = readCachedPreferences();
    if (cached) {
      if (isThemeMode(cached.mode)) setTheme(cached.mode);
      if (isAccentColor(cached.accentColor)) setAccentColorState(cached.accentColor);
    }

    let active = true;
    let db: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      db = createSupabaseBrowserClient();
    } catch {
      setPreferencesReady(true);
      return () => {
        active = false;
      };
    }
    const loadProfilePreferences = async (userId: string | null) => {
      if (!active) return;
      const currentGeneration = ++generation.current;
      if (!userId) {
        if (active) setPreferencesReady(true);
        return;
      }
      setPreferencesReady(false);
      try {
        const { data, error } = await db
          .from('profiles')
          .select('theme_mode,theme_accent')
          .eq('id', userId)
          .maybeSingle();
        if (!active || generation.current !== currentGeneration) return;
        if (!error && data) {
          const profileMode = isThemeMode(data.theme_mode) ? data.theme_mode : 'system';
          const profileAccent = isAccentColor(data.theme_accent) ? data.theme_accent : 'green';
          setTheme(profileMode);
          setAccentColorState(profileAccent);
          writeCachedPreferences(profileMode, profileAccent);
        }
      } catch {
        // Keep the local choice when the profile cannot be loaded.
      } finally {
        if (active && generation.current === currentGeneration) setPreferencesReady(true);
      }
    };

    void db.auth
      .getUser()
      .then(({ data: { user } }) => loadProfilePreferences(user?.id ?? null))
      .catch(() => {
        if (active) setPreferencesReady(true);
      });
    const { data: authSubscription } = db.auth.onAuthStateChange((_event, session) => {
      void loadProfilePreferences(session?.user?.id ?? null);
    });
    return () => {
      active = false;
      authSubscription.subscription.unsubscribe();
    };
  }, [setTheme]);

  const value = useMemo<ClubThemeContextValue>(
    () => ({
      mode,
      accentColor,
      preferencesReady,
      setMode: (nextMode) => {
        setTheme(nextMode);
        writeCachedPreferences(nextMode, accentColor);
      },
      setAccentColor: (nextColor) => {
        setAccentColorState(nextColor);
        document.documentElement.dataset.accent = nextColor;
        writeCachedPreferences(mode, nextColor);
      },
    }),
    [mode, accentColor, preferencesReady, setTheme],
  );

  useEffect(() => {
    document.documentElement.dataset.accent = accentColor;
  }, [accentColor]);

  return <ClubThemeContext.Provider value={value}>{children}</ClubThemeContext.Provider>;
}

export function ClubThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="club-theme-mode"
      disableTransitionOnChange
    >
      <SyncedClubThemeProvider>{children}</SyncedClubThemeProvider>
    </NextThemesProvider>
  );
}

export function useClubTheme() {
  const context = useContext(ClubThemeContext);
  if (!context) throw new Error('useClubTheme must be used within ClubThemeProvider.');
  return context;
}
