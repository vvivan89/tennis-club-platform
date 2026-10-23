'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
type Settings = {
  single_price_cad: number;
  family_price_cad: number;
  family_max_adults: number;
  family_max_children: number;
  season_start_month: number;
  season_end_month: number;
};
const months = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2024, i, 1).toLocaleString('en-CA', { month: 'long' }),
}));
export function MembershipTypesAdmin({ initial }: { initial: Settings }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  function field(key: keyof Settings, label: string, min = 0, max = 100000) {
    return (
      <label className="block text-sm">
        {label}
        <Input
          className="mt-1"
          type="number"
          step={key.includes('_cad') ? '0.01' : '1'}
          min={min}
          max={max}
          value={v[key]}
          onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
        />
      </label>
    );
  }
  async function save() {
    setBusy(true);
    setMessage('');
    const year = new Date().getFullYear();
    const startDate = `${year}-${String(v.season_start_month).padStart(2, '0')}-01`;
    const endYear = v.season_end_month < v.season_start_month ? year + 1 : year;
    const endDay = new Date(endYear, v.season_end_month, 0).getDate();
    const endDate = `${endYear}-${String(v.season_end_month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    try {
      const r = await fetch('/api/admin/membership-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, season_start_date: startDate, season_end_date: endDate }),
      });
      const j = await r.json();
      if (!r.ok)
        console.error('[Membership settings] Save failed', { status: r.status, result: j });
      setMessage(
        r.ok
          ? 'Membership settings saved.'
          : 'Could not save membership settings. Please try again.',
      );
    } catch (e) {
      console.error('[Membership settings] Request failed', e);
      setMessage('Could not save membership settings. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-7 max-w-3xl space-y-7">
      <section className="rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Single membership</h2>
        <div className="mt-4 max-w-xs">
          {field('single_price_cad', 'Full-season price (CAD)', 0, 100000)}
          <p className="mt-1 text-xs text-muted-foreground">
            Enter the price in Canadian dollars, for example 150.00.
          </p>
        </div>
      </section>
      <section className="rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Family membership</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {field('family_price_cad', 'Full-season price (CAD)', 0, 100000)}
          {field('family_max_adults', 'Maximum adults', 1, 10)}
          {field('family_max_children', 'Maximum children', 0, 20)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The limits include all confirmed family members. Children are determined using date of
          birth; accounts without a date of birth count as adults.
        </p>
      </section>
      <section className="rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Membership season</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One shared season applies to every member. The start date is the first day of the selected
          month; the end date is the last day of the selected month.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(['season_start_month', 'season_end_month'] as const).map((key, i) => (
            <label key={key} className="block text-sm">
              {i === 0 ? 'Season start month' : 'Season end month'}
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                value={v[key]}
                onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>
      <div className="flex items-center gap-4">
        <Button onClick={save} disabled={busy}>
          {busy ? <TennisLoader compact label="Saving" /> : 'Save settings'}
        </Button>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
