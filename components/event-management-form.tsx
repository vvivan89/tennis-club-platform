'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type EventFormValues = {
  id?: string;
  series_id?: string | null;
  organizer_id?: string | null;
  title: string;
  description: string;
  gender_restriction: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string;
  registration_opens_at: string;
  registration_closes_at: string;
  capacity: number;
  price_cents: number;
  members_only: boolean;
  status: string;
  location: string;
  notes: string;
  waitlist_enabled: boolean;
  court_count: number;
};
const localValue = (value?: string | null) =>
  value
    ? new Date(value)
        .toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
        .replace(' ', 'T')
        .slice(0, 16)
    : '';
const initial: EventFormValues = {
  title: '',
  description: '',
  gender_restriction: null,
  event_type: 'social',
  starts_at: '',
  ends_at: '',
  registration_opens_at: '',
  registration_closes_at: '',
  capacity: 16,
  price_cents: 0,
  members_only: true,
  status: 'published',
  location: 'Port Coquitlam Tennis Club',
  notes: '',
  waitlist_enabled: true,
  court_count: 4,
};
export function EventManagementForm({
  event,
  currentUserId = '',
  organizerOptions = [],
  showOrganizerField = false,
}: {
  event?: Partial<EventFormValues> & { id?: string; created_by?: string | null };
  currentUserId?: string;
  organizerOptions?: Array<{ id: string; full_name: string | null; email: string; role: string }>;
  showOrganizerField?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<EventFormValues>({
    ...initial,
    ...event,
    organizer_id: event?.organizer_id ?? event?.created_by ?? currentUserId,
    description: event?.description ?? '',
    gender_restriction: event?.gender_restriction ?? null,
    location: event?.location ?? initial.location,
    notes: event?.notes ?? '',
    starts_at: localValue(event?.starts_at),
    ends_at: localValue(event?.ends_at),
    registration_opens_at: localValue(event?.registration_opens_at),
    registration_closes_at: localValue(event?.registration_closes_at),
    price_cents: event?.price_cents ?? 0,
    capacity: event?.capacity ?? 16,
    court_count: event?.court_count ?? 4,
  });
  const [applyToSeries, setApplyToSeries] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [until, setUntil] = useState('');
  const [openDays, setOpenDays] = useState('3');
  const [openTime, setOpenTime] = useState('18:00');
  const [closeDays, setCloseDays] = useState('1');
  const [closeTime, setCloseTime] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  function change<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const db = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) throw new Error('Sign in again to continue.');
      const starts = new Date(v.starts_at),
        ends = new Date(v.ends_at);
      if (!(ends > starts)) throw new Error('The session end must be after the start.');
      if (!recurring) {
        if (!v.registration_closes_at) throw new Error('Set a registration cutoff date and time.');
        const openAt = new Date(v.registration_opens_at);
        const closeAt = v.registration_closes_at ? new Date(v.registration_closes_at) : null;
        if (openAt >= starts) throw new Error('Registration must open before the session starts.');
        if (closeAt && closeAt > starts)
          throw new Error('Registration cutoff must be on or before the session start.');
        if (closeAt && closeAt <= openAt)
          throw new Error('Registration cutoff must be after registration opens.');
      }
      if (v.capacity < 1) throw new Error('Maximum attendees must be at least 1.');
      const common = {
        title: v.title.trim(),
        description: v.description.trim(),
        gender_restriction: v.gender_restriction || null,
        capacity: Number(v.capacity),
        price_cents: Math.round(Number(v.price_cents)),
        members_only: v.members_only,
        status: v.status,
        location: v.location.trim(),
        notes: v.notes.trim(),
        waitlist_enabled: v.waitlist_enabled,
        court_count: Number(v.court_count),
        organizer_id: showOrganizerField
          ? v.organizer_id || currentUserId
          : v.organizer_id || event?.created_by || currentUserId,
        updated_at: new Date().toISOString(),
      };
      if (v.id) {
        const datesOnly = {
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
          registration_opens_at: new Date(v.registration_opens_at).toISOString(),
          registration_closes_at: v.registration_closes_at
            ? new Date(v.registration_closes_at).toISOString()
            : null,
        };
        let notifyIds = [v.id];
        if (applyToSeries && v.series_id) {
          const { error: seriesError } = await db
            .from('events')
            .update(common)
            .eq('series_id', v.series_id);
          if (seriesError) throw seriesError;
          const { error: dateError } = await db.from('events').update(datesOnly).eq('id', v.id);
          if (dateError) throw dateError;
          if (v.status === 'cancelled') {
            const { data } = await db.from('events').select('id').eq('series_id', v.series_id);
            notifyIds = (data ?? []).map((e) => e.id);
          }
        } else {
          const { error } = await db
            .from('events')
            .update({ ...common, ...datesOnly })
            .eq('id', v.id);
          if (error) throw error;
        }
        if (v.status === 'cancelled') {
          try {
            await fetch('/api/notifications/dispatch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventIds: notifyIds }),
            });
          } catch {}
        }
        setMessage(
          applyToSeries && v.series_id
            ? 'Shared fields updated across the recurring series.'
            : 'Event updated.',
        );
        router.push(`/events/${v.id}`);
        router.refresh();
        return;
      }
      const dates: Date[] = [new Date(starts)];
      if (recurring) {
        if (!until) throw new Error('Choose the last date for this recurring event.');
        const endDate = new Date(`${until}T23:59:59`);
        if (endDate < starts)
          throw new Error('Repeat-until date must be on or after the first session.');
        let cursor = new Date(starts);
        let guard = 0;
        while (guard++ < 160) {
          if (frequency === 'weekly') {
            cursor = new Date(cursor);
            cursor.setDate(cursor.getDate() + 7);
          } else if (frequency === 'biweekly') {
            cursor = new Date(cursor);
            cursor.setDate(cursor.getDate() + 14);
          } else {
            const day = cursor.getDate();
            const nextMonth = new Date(
              cursor.getFullYear(),
              cursor.getMonth() + 1,
              1,
              cursor.getHours(),
              cursor.getMinutes(),
            );
            const lastDay = new Date(
              nextMonth.getFullYear(),
              nextMonth.getMonth() + 1,
              0,
            ).getDate();
            nextMonth.setDate(Math.min(day, lastDay));
            cursor = nextMonth;
          }
          if (cursor > endDate) break;
          dates.push(new Date(cursor));
        }
        if (guard >= 160) throw new Error('The recurrence range is too long.');
      }
      const duration = ends.getTime() - starts.getTime();
      const rows = dates.map((start) => {
        const end = new Date(start.getTime() + duration);
        let opens: Date, closes: Date | null;
        if (recurring) {
          const openDate = new Date(start);
          openDate.setDate(openDate.getDate() - Number(openDays));
          const [oh, om] = openTime.split(':').map(Number);
          openDate.setHours(oh, om, 0, 0);
          opens = openDate;
          const closeDate = new Date(start);
          closeDate.setDate(closeDate.getDate() - Number(closeDays));
          const [ch, cm] = closeTime.split(':').map(Number);
          closeDate.setHours(ch, cm, 0, 0);
          closes = closeDate;
          if (opens >= start)
            throw new Error('Recurring registration must open before each session.');
          if (closes > start)
            throw new Error('Recurring registration cutoff must be on or before each session.');
        } else {
          opens = new Date(v.registration_opens_at);
          closes = v.registration_closes_at ? new Date(v.registration_closes_at) : null;
        }
        if (closes && closes <= opens)
          throw new Error('Registration cutoff must be after registration opens.');
        return {
          ...common,
          series_id: null,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          registration_opens_at: opens.toISOString(),
          registration_closes_at: closes?.toISOString() ?? null,
          created_by: user.id,
          title: dates.length > 1 ? `${v.title.trim()}` : v.title.trim(),
        };
      });
      let seriesId: string | undefined;
      if (recurring) {
        const { data: series, error } = await db
          .from('event_series')
          .insert({
            title: v.title.trim(),
            recurrence_rule: {
              frequency,
              registration_open_days_before: Number(openDays),
              registration_open_time: openTime,
              registration_close_days_before: Number(closeDays),
              registration_close_time: closeTime,
            },
            starts_on: v.starts_at.slice(0, 10),
            repeats_until: until,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (error) throw error;
        seriesId = series.id;
      }
      const eventRows = rows.map((row) => ({ ...row, series_id: seriesId ?? null }));
      const { data: created, error } = await db.from('events').insert(eventRows).select('id');
      if (error) throw error;
      try {
        await fetch('/api/notifications/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventIds: (created ?? []).map((x) => x.id) }),
        });
      } catch {}
      setMessage(
        `${created?.length ?? rows.length} event session${rows.length === 1 ? '' : 's'} created.`,
      );
      router.push('/admin/events');
      router.refresh();
    } catch (err) {
      console.error('[Event management] Event save failed', err);
      setError('Could not save event. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      {v.id && v.series_id && (
        <section className="rounded-xl border border-border p-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyToSeries}
              onChange={(e) => setApplyToSeries(e.target.checked)}
              className="mt-1"
            />
            <span>
              <strong>Apply shared fields to all recurring sessions</strong>
              <span className="mt-1 block text-muted-foreground">
                Updates title, description, gender restriction, publication status, capacity, price,
                location, membership requirement, waitlist, and available courts. Dates,
                participants, and court assignments remain unchanged for other sessions.
              </span>
            </span>
          </label>
        </section>
      )}
      <section className="grid gap-4 rounded-xl border border-border p-5 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          Event title
          <Input
            required
            maxLength={160}
            value={v.title}
            onChange={(e) => change('title', e.target.value)}
          />
        </label>
        {showOrganizerField && (
          <label className="space-y-1 text-sm font-medium">
            Organizer
            <select
              required
              value={v.organizer_id ?? currentUserId}
              onChange={(e) => change('organizer_id', e.target.value)}
              className="block h-10 w-full rounded-md border border-input bg-background px-3"
            >
              {organizerOptions.map((organizer) => (
                <option key={organizer.id} value={organizer.id}>
                  {organizer.full_name || organizer.email} ({organizer.role})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="space-y-1 text-sm font-medium">
          Participant gender restriction (optional)
          <select
            value={v.gender_restriction ?? ''}
            onChange={(e) => change('gender_restriction', e.target.value || null)}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="">No restriction</option>
            <option value="male">Male participants only</option>
            <option value="female">Female participants only</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Publication
          <select
            value={v.status}
            onChange={(e) => change('status', e.target.value)}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          Description
          <textarea
            value={v.description}
            onChange={(e) => change('description', e.target.value)}
            maxLength={5000}
            className="min-h-24 w-full rounded-md border border-input bg-background p-3"
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Session starts
          <Input
            type="datetime-local"
            required
            value={v.starts_at}
            onChange={(e) => change('starts_at', e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Session ends
          <Input
            type="datetime-local"
            required
            value={v.ends_at}
            onChange={(e) => change('ends_at', e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Registration opens
          <Input
            type="datetime-local"
            required
            disabled={recurring}
            value={v.registration_opens_at}
            onChange={(e) => change('registration_opens_at', e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Registration cutoff
          <Input
            type="datetime-local"
            required={!recurring}
            disabled={recurring}
            value={v.registration_closes_at}
            onChange={(e) => change('registration_closes_at', e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Cost per person (CAD)
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            value={(v.price_cents / 100).toString()}
            onChange={(e) => change('price_cents', Math.round(Number(e.target.value || 0) * 100))}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Maximum attendees
          <Input
            type="number"
            min="1"
            max="1000"
            required
            value={v.capacity}
            onChange={(e) => change('capacity', Number(e.target.value))}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Location
          <Input required value={v.location} onChange={(e) => change('location', e.target.value)} />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Courts available
          <select
            value={v.court_count}
            onChange={(e) => change('court_count', Number(e.target.value))}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.members_only}
            onChange={(e) => change('members_only', e.target.checked)}
          />{' '}
          Active paid membership required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.waitlist_enabled}
            onChange={(e) => change('waitlist_enabled', e.target.checked)}
          />{' '}
          Enable waitlist when full
        </label>
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          Organizer notes
          <textarea
            value={v.notes}
            onChange={(e) => change('notes', e.target.value)}
            className="min-h-20 w-full rounded-md border border-input bg-background p-3"
          />
        </label>
      </section>
      {!v.id && (
        <section className="rounded-xl border border-border p-5">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
            />{' '}
            Repeat this event
          </label>
          {recurring && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                Repeat
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                >
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                Repeat until
                <Input
                  type="date"
                  required
                  value={until}
                  min={v.starts_at.slice(0, 10)}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
              <div className="sm:col-span-2">
                <p className="text-sm font-semibold">Recurring registration schedule</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  For every session, registration opens the selected number of days before the
                  session at the selected time, and closes on the chosen cutoff schedule.
                </p>
              </div>
              <label className="space-y-1 text-sm">
                Open registration days before
                <Input
                  type="number"
                  min="0"
                  max="180"
                  value={openDays}
                  onChange={(e) => setOpenDays(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Registration opening time
                <Input
                  type="time"
                  required
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Close registration days before
                <Input
                  type="number"
                  min="0"
                  max="180"
                  value={closeDays}
                  onChange={(e) => setCloseDays(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Registration cutoff time
                <Input
                  type="time"
                  required
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                />
              </label>
            </div>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Button disabled={busy}>
        {busy ? (
          <TennisLoader compact label="Saving" />
        ) : v.id ? (
          'Save event changes'
        ) : (
          'Create event session(s)'
        )}
      </Button>
    </form>
  );
}
