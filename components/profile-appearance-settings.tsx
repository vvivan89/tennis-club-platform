'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useClubTheme, type ClubThemeMode } from '@/components/club-theme-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TennisLoader } from '@/components/tennis-loader';
import { requireBrowserUser } from '@/lib/supabase-browser-user';

const themeModes: Array<{ value: ClubThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];
const accentOptions = [
  { value: 'blue', label: 'Hard' },
  { value: 'green', label: 'Grass' },
  { value: 'orange', label: 'Clay' },
] as const;

export function ProfileAppearanceSettings({
  onSaved,
  onError,
}: {
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const { mode, accentColor, preferencesReady, setMode, setAccentColor } = useClubTheme();
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const { db, user } = await requireBrowserUser('Please sign in again.');
      const { error } = await db
        .from('profiles')
        .update({
          theme_mode: mode,
          theme_accent: accentColor,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (error) throw error;
      onSaved('Appearance preferences saved.');
      router.refresh();
    } catch (error) {
      console.error('[Member profile] Appearance preferences could not be saved', error);
      onError('Could not save appearance preferences. Your selection is kept on this device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose how the site looks. Your saved choice follows your account to other devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] md:gap-6">
            <fieldset disabled={!preferencesReady || busy} className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Theme</legend>
              <div className="grid grid-cols-3 gap-2">
                {themeModes.map((option) => {
                  const selected = mode === option.value;
                  const Icon =
                    option.value === 'light' ? Sun : option.value === 'dark' ? Moon : Monitor;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setMode(option.value)}
                      className={`flex h-[108px] flex-col items-center justify-center gap-1 rounded-lg border p-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-secondary ring-2 ring-ring/30' : 'border-border hover:bg-muted/60'}`}
                    >
                      <Icon className="h-6 w-6" aria-hidden="true" />
                      <span className="font-medium">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div
              className="appearance-settings-divider hidden self-stretch bg-border md:block"
              aria-hidden="true"
            />
            <fieldset
              disabled={!preferencesReady || busy}
              className="space-y-2 border-t border-border pt-5 md:border-t-0 md:pt-0"
            >
              <legend className="mb-2 text-sm font-medium">Color scheme</legend>
              <div className="grid grid-cols-3 gap-2">
                {accentOptions.map((option) => {
                  const selected = accentColor === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setAccentColor(option.value)}
                      className={`flex h-[108px] flex-col items-center justify-center gap-2 rounded-lg border p-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-secondary ring-2 ring-ring/30' : 'border-border hover:bg-muted/60'}`}
                    >
                      <span
                        className={`appearance-court appearance-court--${option.value}`}
                        aria-hidden="true"
                      >
                        <span className="appearance-court__surface" />
                        <Image
                          src="/images/tennis-court-lines.png"
                          alt=""
                          width={512}
                          height={512}
                          className="appearance-court__diagram appearance-court__diagram--rotated"
                        />
                      </span>
                      <span className="font-medium">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!preferencesReady && (
              <p className="text-xs text-muted-foreground" role="status">
                <TennisLoader compact label="Loading saved appearance" />
              </p>
            )}
            <Button type="submit" disabled={!preferencesReady || busy}>
              {busy ? <TennisLoader compact label="Saving" /> : 'Save appearance'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
