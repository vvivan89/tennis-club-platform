'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { requireBrowserUser } from '@/lib/supabase-browser-user';
import { useClubTheme, type ClubThemeMode } from '@/components/club-theme-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TennisLoader } from '@/components/tennis-loader';

const themeModes: Array<{ value: ClubThemeMode; label: string; description: string }> = [
  { value: 'light', label: 'Light', description: 'Always use the light appearance.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark appearance.' },
  { value: 'system', label: 'System', description: 'Follow your device appearance setting.' },
];

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
          <fieldset disabled={!preferencesReady || busy} className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Theme</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {themeModes.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${mode === option.value ? 'border-primary bg-secondary' : 'border-border'}`}
                >
                  <input
                    type="radio"
                    name="theme-mode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className="mt-1 accent-primary"
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5 text-sm font-medium">
            Court preference (accent color)
            <select
              value={accentColor}
              onChange={(event) =>
                setAccentColor(event.target.value as 'blue' | 'green' | 'orange')
              }
              disabled={!preferencesReady || busy}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="blue">Hard (blue)</option>
              <option value="green">Grass (green)</option>
              <option value="orange">Clay (brown)</option>
            </select>
          </label>
          {!preferencesReady && (
            <p className="text-xs text-muted-foreground" role="status">
              <TennisLoader compact label="Loading saved appearance" />
            </p>
          )}
          <Button type="submit" disabled={!preferencesReady || busy}>
            {busy ? <TennisLoader compact label="Saving" /> : 'Save appearance'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
