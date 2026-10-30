'use client';
import { formatClockTime } from '@/lib/time-format';
import { TennisLoader } from '@/components/tennis-loader';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { reorderRankingPriority, type TournamentConfig } from '@/lib/tournament-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TournamentRulesEditor } from '@/components/tournament-rules-editor';

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
  tournament_format: string | null;
  tournament_config: TournamentConfig;
  tournament_rules_html: string;
  allow_non_member_registration: boolean;
  tournament_details_public: boolean;
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
  tournament_format: 'doubles',
  tournament_config: {
    categories: ['mixed', 'men', 'women'],
    phases: {
      round_robin: true,
      preliminary_knockout: false,
      final_knockout: true,
      team_round_robin: true,
      team_knockout: true,
    },
    group_count: 2,
    teams_per_group: 4,
    registration_mode: 'both',
    ranking_priority: ['matches_won', 'sets_won', 'games_won'],
    schedule: { match_minutes: 60, break_minutes: 15 },
    scoring_template: 'best_of_three',
  },
  tournament_rules_html: '',
  allow_non_member_registration: false,
  tournament_details_public: true,
};
function generateRulesText(v: EventFormValues): string {
  const format = v.tournament_format === 'team' ? 'Team tournament' : 'Doubles tournament';
  const categoryNames = (v.tournament_config.categories ?? []).map((category) => {
    if (category === 'men') return "men's doubles";
    if (category === 'women') return "women's doubles";
    return 'mixed doubles';
  });
  const phases = v.tournament_config.phases ?? {};
  const scoringTemplates: Record<string, string> = {
    one_set: 'one set',
    two_sets_then_third: 'best of three sets',
    best_of_three: 'best of three sets',
    team_two_sets_bonus_third:
      'two sets; a 2–0 win earns 3 team points; if split 1–1, play a third set for 2 points to the winner and 1 to the loser',
  };
  const scoringLabel = (template?: string) =>
    scoringTemplates[template ?? v.tournament_config.scoring_template ?? 'best_of_three'] ??
    'best of three sets';
  const phaseScoring = [
    [phases.round_robin, 'Round robin', 'round_robin'],
    [phases.preliminary_knockout, 'Preliminary knockout', 'preliminary_knockout'],
    [phases.final_knockout, 'Final knockout', 'final_knockout'],
    [phases.team_round_robin, 'Team round robin', 'team_round_robin'],
    [phases.team_knockout, 'Team knockout', 'team_knockout'],
  ]
    .filter(([enabled]) => enabled)
    .map(
      ([, label, key]) =>
        `${label}: ${scoringLabel(v.tournament_config.scoring_templates?.[key as keyof NonNullable<TournamentConfig['scoring_templates']>])}`,
    );
  const scoring = phaseScoring.length ? phaseScoring.join('; ') : scoringLabel();
  const registration =
    v.tournament_config.registration_mode === 'single'
      ? 'Players register individually and the organizer assigns partners.'
      : v.tournament_config.registration_mode === 'doubles'
        ? 'Players register with a partner.'
        : 'Players may register individually for organizer-assigned pairing or register with a partner.';
  const eligibility = v.allow_non_member_registration
    ? 'Eligible members and non-members may register; non-member accounts are not created.'
    : 'Registration is limited to eligible club members; non-member registration is not enabled.';
  const dates = `${v.starts_at ? new Date(v.starts_at).toLocaleString() : ''}${v.ends_at ? `${v.starts_at ? ' – ' : ''}${new Date(v.ends_at).toLocaleString()}` : ''}`;
  const phaseNames = [
    phases.round_robin || phases.team_round_robin ? 'round robin' : '',
    phases.preliminary_knockout ? 'preliminary single-elimination knockout' : '',
    phases.final_knockout || phases.team_knockout ? 'final single-elimination knockout' : '',
  ]
    .filter(Boolean)
    .join(', ');
  const promotionEnabled =
    v.tournament_format === 'team'
      ? phases.team_round_robin && phases.team_knockout
      : phases.round_robin && phases.final_knockout;

  return [
    `<h2>${format}</h2>`,
    dates ? `<p>Dates: ${dates}.</p>` : '',
    Number.isFinite(v.price_cents)
      ? `<p>Cost: ${v.price_cents === 0 ? 'Free' : `$${(v.price_cents / 100).toFixed(2)} CAD per participant`}.</p>`
      : '',
    `<p>Registration: ${registration}</p>`,
    `<p>Who can register: ${eligibility}</p>`,
    categoryNames.length ? `<p>Eligible categories: ${categoryNames.join(', ')}.</p>` : '',
    `<p>Scoring: ${scoring}.</p>`,
    phaseNames ? `<p>Competition phases: ${phaseNames}.</p>` : '',
    promotionEnabled
      ? `<p>Knockout qualification: the top ${Math.max(1, Number(v.tournament_config.promoted_teams_per_group ?? 2))} teams from each group advance.</p>`
      : '',
    v.registration_closes_at
      ? `<p>Registration closes: ${new Date(v.registration_closes_at).toLocaleString()}.</p>`
      : '',
  ]
    .filter(Boolean)
    .join('');
}

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
    members_only: event?.event_type === 'tournament' ? false : (event?.members_only ?? true),
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
    tournament_format: event?.tournament_format ?? 'doubles',
    tournament_config: event?.tournament_config ?? initial.tournament_config,
    tournament_rules_html: event?.tournament_rules_html ?? '',
    allow_non_member_registration: event?.allow_non_member_registration ?? false,
    tournament_details_public: event?.tournament_details_public ?? true,
  });
  const [applyToSeries, setApplyToSeries] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [until, setUntil] = useState('');
  const [seriesStartDate, setSeriesStartDate] = useState(
    event?.starts_at ? localValue(event.starts_at).slice(0, 10) : '',
  );
  const [dayOfWeek, setDayOfWeek] = useState(
    String(event?.starts_at ? new Date(localValue(event.starts_at)).getDay() : 6),
  );
  const [seriesStartTime, setSeriesStartTime] = useState(
    event?.starts_at ? localValue(event.starts_at).slice(11, 16) : '09:00',
  );
  const [seriesEndTime, setSeriesEndTime] = useState(
    event?.ends_at ? localValue(event.ends_at).slice(11, 16) : '10:00',
  );
  const [openDays, setOpenDays] = useState('3');
  const [openTime, setOpenTime] = useState('18:00');
  const [closeDays, setCloseDays] = useState('1');
  const [closeTime, setCloseTime] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!error && !message) return;
    const timer = window.setTimeout(() => {
      setError('');
      setMessage('');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, message]);
  function change<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }
  const firstSeriesDate = useMemo(() => {
    if (!seriesStartDate) return null;
    const date = new Date(`${seriesStartDate}T12:00:00`);
    const desiredDay = Number(dayOfWeek);
    date.setDate(date.getDate() + ((desiredDay - date.getDay() + 7) % 7));
    return date;
  }, [seriesStartDate, dayOfWeek]);
  const previewRegistrationDate = (daysBefore: string) => {
    const desiredDay = Number(dayOfWeek);
    const days = Number(daysBefore);
    if (
      !Number.isInteger(desiredDay) ||
      desiredDay < 0 ||
      desiredDay > 6 ||
      !Number.isFinite(days) ||
      days < 0
    )
      return '';
    // Use a fixed Sunday anchor so this preview depends on the selected weekday, not the series start date.
    const date = new Date('2024-01-07T12:00:00');
    date.setDate(date.getDate() + desiredDay - Math.floor(days));
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  };
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
      const starts =
        recurring && firstSeriesDate
          ? new Date(`${firstSeriesDate.toISOString().slice(0, 10)}T${seriesStartTime}`)
          : new Date(v.starts_at);
      const ends = recurring
        ? new Date(
            `${firstSeriesDate?.toISOString().slice(0, 10) ?? seriesStartDate}T${seriesEndTime}`,
          )
        : new Date(v.ends_at);
      if (recurring && !seriesStartDate)
        throw new Error('Choose a start date for the event series.');
      if (!(ends > starts)) throw new Error('The event end must be after the start time.');
      if (v.event_type === 'tournament' && recurring)
        throw new Error('Tournament events cannot be recurring.');
      if (
        v.event_type === 'tournament' &&
        v.tournament_format !== 'team' &&
        !(v.tournament_config.categories ?? []).length
      )
        throw new Error('Enable at least one doubles category.');
      if (
        v.event_type === 'tournament' &&
        v.tournament_config.phases?.preliminary_knockout &&
        !v.tournament_config.phases?.round_robin
      )
        throw new Error('Preliminary knockout requires round robin.');
      if (!recurring) {
        if (!v.registration_closes_at) throw new Error('Set a registration cutoff date and time.');
        const openAt = new Date(v.registration_opens_at);
        const closeAt = v.registration_closes_at ? new Date(v.registration_closes_at) : null;
        if (openAt >= starts) throw new Error('Registration must open before the event starts.');
        if (closeAt && closeAt > starts)
          throw new Error('Registration cutoff must be on or before the event start.');
        if (closeAt && closeAt <= openAt)
          throw new Error('Registration cutoff must be after registration opens.');
      }
      if (v.event_type !== 'tournament' && v.capacity < 1)
        throw new Error('Maximum attendees must be at least 1.');
      if (v.event_type === 'tournament') {
        for (const [category, limit] of Object.entries(
          v.tournament_config.category_capacities ?? {},
        )) {
          if (limit != null && (!Number.isInteger(Number(limit)) || Number(limit) < 1))
            throw new Error(
              `Capacity for ${category} must be a positive whole number or left blank.`,
            );
        }
      }
      const common = {
        title: v.title.trim(),
        description: v.description.trim(),
        gender_restriction: v.gender_restriction || null,
        capacity:
          v.event_type === 'tournament'
            ? Number(v.capacity) > 0
              ? Number(v.capacity)
              : 1000000
            : Number(v.capacity),
        price_cents: Math.round(Number(v.price_cents)),
        members_only: v.event_type === 'tournament' ? false : v.members_only,
        status: v.status,
        location: v.location.trim(),
        notes: v.notes.trim(),
        waitlist_enabled: v.waitlist_enabled,
        court_count: Number(v.court_count),
        event_type: v.event_type,
        tournament_format: v.event_type === 'tournament' ? v.tournament_format : null,
        tournament_config:
          v.event_type === 'tournament'
            ? {
                ...v.tournament_config,
                total_capacity:
                  Number(v.capacity) > 0 && Number(v.capacity) < 1000000
                    ? Number(v.capacity)
                    : null,
              }
            : {},
        tournament_rules_html: v.event_type === 'tournament' ? v.tournament_rules_html : '',
        allow_non_member_registration:
          v.event_type === 'tournament' ? v.allow_non_member_registration : false,
        tournament_details_public:
          v.event_type === 'tournament' ? v.tournament_details_public : false,
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
          throw new Error('Repeat-until date must be on or after the first event.');
        let cursor = new Date(starts);
        let guard = 0;
        while (guard++ < 160) {
          let next: Date;
          if (frequency === 'weekly' || frequency === 'biweekly') {
            next = new Date(cursor);
            next.setDate(next.getDate() + (frequency === 'weekly' ? 7 : 14));
          } else {
            const current = new Date(cursor);
            const targetMonth = new Date(
              current.getFullYear(),
              current.getMonth() + 1,
              1,
              current.getHours(),
              current.getMinutes(),
            );
            const targetDay = Number(dayOfWeek);
            const firstDay = targetMonth.getDay();
            targetMonth.setDate(1 + ((targetDay - firstDay + 7) % 7));
            // Preserve the week-of-month ordinal when possible.
            const ordinal = Math.floor((current.getDate() - 1) / 7);
            targetMonth.setDate(targetMonth.getDate() + ordinal * 7);
            if (targetMonth.getMonth() !== (current.getMonth() + 1) % 12)
              targetMonth.setDate(targetMonth.getDate() - 7);
            next = targetMonth;
          }
          if (next > endDate) break;
          dates.push(new Date(next));
          cursor = next;
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
            throw new Error('Recurring registration must open before each event.');
          if (closes > start)
            throw new Error('Recurring registration cutoff must be on or before each event.');
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
              day_of_week: Number(dayOfWeek),
              session_start_time: seriesStartTime,
              session_end_time: seriesEndTime,
              registration_open_days_before: Number(openDays),
              registration_open_time: openTime,
              registration_close_days_before: Number(closeDays),
              registration_close_time: closeTime,
            },
            starts_on:
              firstSeriesDate?.toISOString().slice(0, 10) ||
              seriesStartDate ||
              v.starts_at.slice(0, 10),
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
      void fetch('/api/notifications/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventIds: (created ?? []).map((x) => x.id) }),
      }).catch(() => {});
      setMessage(`${created?.length ?? rows.length} event${rows.length === 1 ? '' : 's'} created.`);
      router.push('/admin/events');
      router.refresh();
    } catch (err) {
      console.error('[Event management] Event save failed', err);
      setError(err instanceof Error ? err.message : 'Could not save event. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      {(error || message) && (
        <div
          className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
          aria-live="polite"
        >
          {error && (
            <p
              role="alert"
              className="pointer-events-auto rounded-md border border-destructive/30 bg-background p-3 text-sm text-destructive shadow-lg"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              role="status"
              className="pointer-events-auto rounded-md border border-emerald-600/30 bg-background p-3 text-sm shadow-lg"
            >
              {message}
            </p>
          )}
        </div>
      )}
      {v.id && v.series_id && (
        <section className="rounded-xl border border-border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyToSeries}
              onChange={(e) => setApplyToSeries(e.target.checked)}
              className="mt-1"
            />
            <span>
              <strong>Apply shared fields to all recurring events</strong>
              <span className="mt-1 block text-muted-foreground">
                Updates title, description, gender restriction, publication status, capacity, price,
                location, membership requirement, waitlist, and available courts. Dates,
                participants, and court assignments remain unchanged for other events.
              </span>
            </span>
          </label>
        </section>
      )}
      <section className="grid gap-4 rounded-xl border border-border p-5 sm:grid-cols-2">
        <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
            Event title
            <Input
              required
              maxLength={160}
              value={v.title}
              onChange={(e) => change('title', e.target.value)}
            />
          </label>
        </div>
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
          Event type
          <select
            value={
              v.event_type === 'tournament'
                ? v.tournament_format === 'team'
                  ? 'team_tournament'
                  : 'doubles_tournament'
                : 'social'
            }
            onChange={(e) => {
              const value = e.target.value;
              change('event_type', value === 'social' ? 'social' : 'tournament');
              if (value !== 'social') {
                change('members_only', false);
                change('tournament_format', value === 'team_tournament' ? 'team' : 'doubles');
                if (value === 'team_tournament') {
                  change('tournament_config', {
                    ...v.tournament_config,
                    ranking_priority: ['points', 'matches_won', 'sets_won', 'games_won'],
                  });
                } else {
                  change('tournament_config', {
                    ...v.tournament_config,
                    ranking_priority: (
                      v.tournament_config.ranking_priority ?? [
                        'matches_won',
                        'sets_won',
                        'games_won',
                      ]
                    ).filter((key) => key !== 'points'),
                  });
                }
                setRecurring(false);
              }
            }}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="social">Social event</option>
            <option value="doubles_tournament">Doubles tournament</option>
            <option value="team_tournament">Team tournament</option>
          </select>
        </label>
        {v.event_type !== 'tournament' && (
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
        )}
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
        {v.event_type !== 'tournament' && (
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            Description
            <textarea
              value={v.description}
              onChange={(e) => change('description', e.target.value)}
              maxLength={5000}
              className="min-h-24 w-full rounded-md border border-input bg-background p-3"
            />
          </label>
        )}
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
          {v.event_type === 'tournament'
            ? 'Total tournament capacity (optional)'
            : 'Maximum attendees'}
          <Input
            type="number"
            min="1"
            max="1000"
            required={v.event_type !== 'tournament'}
            value={v.event_type === 'tournament' && v.capacity >= 1000000 ? '' : v.capacity || ''}
            placeholder={v.event_type === 'tournament' ? 'Unlimited' : undefined}
            onChange={(e) => change('capacity', e.target.value === '' ? 0 : Number(e.target.value))}
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
        {v.event_type !== 'tournament' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.members_only}
              onChange={(e) => change('members_only', e.target.checked)}
            />{' '}
            Active paid membership required
          </label>
        )}
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
      {v.event_type === 'tournament' && (
        <section className="space-y-5 rounded-xl border border-border p-5">
          <div>
            <h2 className="text-lg font-semibold">Tournament configuration</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tournament participants, draws, match schedules and results are managed on the event
              page.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {v.tournament_format !== 'team' && (
              <fieldset className="space-y-3 rounded-md border border-border p-3">
                <legend className="text-sm font-medium">
                  Enabled doubles categories and capacity
                </legend>
                <div className="space-y-2">
                  {(
                    [
                      ['mixed', 'Mixed doubles'],
                      ['men', "Men's doubles"],
                      ['women', "Women's doubles"],
                    ] as const
                  ).map(([key, label]) => {
                    const enabled = (v.tournament_config.categories ?? []).includes(key);
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3"
                      >
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) =>
                              change('tournament_config', {
                                ...v.tournament_config,
                                categories: e.target.checked
                                  ? [...new Set([...(v.tournament_config.categories ?? []), key])]
                                  : (v.tournament_config.categories ?? []).filter(
                                      (item: string) => item !== key,
                                    ),
                              })
                            }
                          />
                          {label}
                        </label>
                        {enabled && (
                          <Input
                            aria-label={label}
                            type="number"
                            min="1"
                            max="1000"
                            placeholder="No limit"
                            value={v.tournament_config.category_capacities?.[key] ?? ''}
                            onChange={(e) =>
                              change('tournament_config', {
                                ...v.tournament_config,
                                category_capacities: {
                                  ...v.tournament_config.category_capacities,
                                  [key]: e.target.value === '' ? null : Number(e.target.value),
                                },
                              })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Capacity limits count registered participant entries. Both the total limit and the
                  category limit are enforced when registering.
                </p>
              </fieldset>
            )}
            {v.tournament_format === 'team' && (
              <fieldset className="space-y-3 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">Team registration capacity</legend>
                <label className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 text-sm">
                  Team tournament
                  <Input
                    aria-label="Team tournament"
                    type="number"
                    min="1"
                    max="1000"
                    placeholder="No limit"
                    value={v.tournament_config.category_capacities?.team ?? ''}
                    onChange={(e) =>
                      change('tournament_config', {
                        ...v.tournament_config,
                        category_capacities: {
                          ...v.tournament_config.category_capacities,
                          team: e.target.value === '' ? null : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Capacity limits count registered participant entries. Both the total limit and the
                  category limit are enforced when registering.
                </p>
              </fieldset>
            )}
            {v.tournament_format !== 'team' && (
              <fieldset className="space-y-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">Registration options</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(v.tournament_config.registration_mode ?? 'both') !== 'doubles'}
                    onChange={(e) => {
                      const mode = v.tournament_config.registration_mode ?? 'both';
                      change('tournament_config', {
                        ...v.tournament_config,
                        registration_mode: e.target.checked
                          ? mode === 'doubles'
                            ? 'both'
                            : mode
                          : mode === 'both'
                            ? 'doubles'
                            : 'doubles',
                      });
                    }}
                  />
                  <span>
                    <span className="block font-medium">Individually</span>
                    <span className="block text-xs text-muted-foreground">
                      Organizer will pair players.
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(v.tournament_config.registration_mode ?? 'both') !== 'single'}
                    onChange={(e) => {
                      const mode = v.tournament_config.registration_mode ?? 'both';
                      change('tournament_config', {
                        ...v.tournament_config,
                        registration_mode: e.target.checked
                          ? mode === 'single'
                            ? 'both'
                            : mode
                          : mode === 'both'
                            ? 'single'
                            : 'single',
                      });
                    }}
                  />
                  <span>
                    <span className="block font-medium">With partner</span>
                    <span className="block text-xs text-muted-foreground">
                      Register as a doubles pair.
                    </span>
                  </span>
                </label>
              </fieldset>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Competition phases and scoring templates
            </legend>
            <div className="space-y-3">
              {(v.tournament_format === 'team'
                ? ([
                    ['team_round_robin', 'Team round robin'],
                    ['team_knockout', 'Team knockout'],
                  ] as const)
                : ([
                    ['preliminary_knockout', 'Preliminary knockout (requires round robin)'],
                    ['round_robin', 'Round robin'],
                    ['final_knockout', 'Final knockout'],
                  ] as const)
              ).map(([key, label]) => {
                const enabled = !!v.tournament_config.phases?.[key];
                return (
                  <div
                    key={key}
                    className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center"
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={
                          key === 'preliminary_knockout' && !v.tournament_config.phases?.round_robin
                        }
                        onChange={(e) =>
                          change('tournament_config', {
                            ...v.tournament_config,
                            phases: {
                              ...v.tournament_config.phases,
                              [key]: e.target.checked,
                              ...(key === 'round_robin' && !e.target.checked
                                ? { preliminary_knockout: false }
                                : {}),
                            },
                          })
                        }
                      />
                      {label}
                    </label>
                    {enabled && (
                      <label className="block space-y-1 text-sm">
                        <span className="sr-only">{label} scoring template</span>
                        <select
                          aria-label={label}
                          value={
                            v.tournament_config.scoring_templates?.[
                              key as keyof NonNullable<TournamentConfig['scoring_templates']>
                            ] ??
                            v.tournament_config.scoring_template ??
                            'best_of_three'
                          }
                          onChange={(e) =>
                            change('tournament_config', {
                              ...v.tournament_config,
                              scoring_templates: {
                                ...v.tournament_config.scoring_templates,
                                [key]: e.target.value,
                              },
                            })
                          }
                          className="block h-10 w-full rounded-md border border-input bg-background px-3"
                        >
                          <option value="one_set">One set</option>
                          <option value="best_of_three">Best of three sets</option>
                          {v.tournament_format === 'team' && (
                            <option value="team_two_sets_bonus_third">
                              Two sets; if split, third set awards team points
                            </option>
                          )}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Each phase uses its own scoring rules for score validation and generated tournament
              rules.
            </p>
          </fieldset>
          {(v.tournament_format === 'team'
            ? v.tournament_config.phases?.team_round_robin
            : v.tournament_config.phases?.round_robin) && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1 text-sm">
                Group count
                <Input
                  type="number"
                  min="1"
                  max="32"
                  value={v.tournament_config.group_count ?? 2}
                  onChange={(e) =>
                    change('tournament_config', {
                      ...v.tournament_config,
                      group_count: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                Teams per group
                <Input
                  type="number"
                  min="2"
                  max="32"
                  value={v.tournament_config.teams_per_group ?? 4}
                  onChange={(e) =>
                    change('tournament_config', {
                      ...v.tournament_config,
                      teams_per_group: Math.max(2, Number(e.target.value) || 2),
                    })
                  }
                />
              </label>
              {(v.tournament_format === 'team'
                ? v.tournament_config.phases?.team_knockout
                : v.tournament_config.phases?.final_knockout) && (
                <label className="space-y-1 text-sm">
                  Teams promoted from each group
                  <Input
                    type="number"
                    min="1"
                    max={Math.max(1, Number(v.tournament_config.teams_per_group ?? 4))}
                    value={v.tournament_config.promoted_teams_per_group ?? 2}
                    onChange={(e) =>
                      change('tournament_config', {
                        ...v.tournament_config,
                        promoted_teams_per_group: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                  <span className="block text-xs text-muted-foreground">
                    The highest-ranked teams from each group advance to the knockout stage.
                  </span>
                </label>
              )}
            </div>
          )}
          {(v.tournament_format === 'team'
            ? v.tournament_config.phases?.team_round_robin
            : v.tournament_config.phases?.round_robin) && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Group ranking priority (drag to reorder; highest priority first)
              </legend>
              <p className="text-xs text-muted-foreground">
                Drag criteria into the order you want. You can also use the move buttons.
              </p>
              {(() => {
                const options = [
                  ...(v.tournament_format === 'team' ? ([['points', 'Points']] as const) : []),
                  ['matches_won', 'Matches won'],
                  ['sets_won', 'Sets won'],
                  ['games_won', 'Games won'],
                  ['set_difference', 'Set difference'],
                  ['game_difference', 'Game difference'],
                  ['head_to_head', 'Head-to-head'],
                ] as const;
                const optionKeys: string[] = options.map(([key]) => key);
                const defaults: string[] =
                  v.tournament_format === 'team'
                    ? ['points', 'matches_won', 'sets_won', 'games_won']
                    : ['matches_won', 'sets_won', 'games_won'];
                const saved: string[] = (v.tournament_config.ranking_priority ?? defaults).filter(
                  (key) => optionKeys.includes(key as (typeof optionKeys)[number]),
                );
                const withoutPoints: string[] = [
                  ...new Set<string>(saved.filter((key) => key !== 'points')),
                ];
                const priority: string[] =
                  v.tournament_format === 'team' ? ['points', ...withoutPoints] : withoutPoints;
                const reorder = (source: string, targetIndex: number) => {
                  const next = reorderRankingPriority(priority, source, targetIndex);
                  const ordered =
                    v.tournament_format === 'team'
                      ? ['points', ...next.filter((key) => key !== 'points')]
                      : next;
                  change('tournament_config', {
                    ...v.tournament_config,
                    ranking_priority: ordered,
                  });
                };
                return (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div
                      className="rounded-md border border-border p-3"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const source = event.dataTransfer.getData('text/plain');
                        if (source && !priority.includes(source)) {
                          const next = [...priority.filter((key) => key !== 'points'), source];
                          change('tournament_config', {
                            ...v.tournament_config,
                            ranking_priority:
                              v.tournament_format === 'team'
                                ? ['points', ...next.filter((key) => key !== 'points')]
                                : next,
                          });
                        }
                      }}
                    >
                      <h3 className="mb-2 text-sm font-semibold">Selected priorities</h3>
                      <ol className="space-y-2" aria-label="Group ranking priorities">
                        {priority.map((key, index) => {
                          const label = options.find(([option]) => option === key)?.[1] ?? key;
                          return (
                            <li
                              key={key}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', key);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                const source = event.dataTransfer.getData('text/plain');
                                if (source && source !== key) reorder(source, index);
                              }}
                              className="flex items-center gap-2 rounded-md border border-border bg-background p-2 text-sm"
                              data-ranking-key={key}
                            >
                              <span
                                aria-hidden="true"
                                className="cursor-grab select-none text-muted-foreground"
                              >
                                ⠿
                              </span>
                              <span className="w-24 shrink-0 text-muted-foreground">
                                Priority {index + 1}
                              </span>
                              <span className="flex-1">{label}</span>
                              <button
                                type="button"
                                aria-label={`Remove ${label} priority`}
                                disabled={v.tournament_format === 'team' && key === 'points'}
                                onClick={() =>
                                  change('tournament_config', {
                                    ...v.tournament_config,
                                    ranking_priority: priority.filter((item) => item !== key),
                                  })
                                }
                                className="rounded border border-border px-2 py-1 disabled:opacity-40"
                              >
                                −
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${label} up`}
                                disabled={index === 0}
                                onClick={() => reorder(key, index - 1)}
                                className="rounded border border-border px-2 py-1 disabled:opacity-40"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${label} down`}
                                disabled={
                                  index === priority.length - 1 ||
                                  (v.tournament_format === 'team' && key === 'points')
                                }
                                onClick={() => reorder(key, index + 1)}
                                className="rounded border border-border px-2 py-1 disabled:opacity-40"
                              >
                                ↓
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    <div
                      className="rounded-md border border-border p-3"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const source = event.dataTransfer.getData('text/plain');
                        if (source && !(v.tournament_format === 'team' && source === 'points'))
                          change('tournament_config', {
                            ...v.tournament_config,
                            ranking_priority: priority.filter((key) => key !== source),
                          });
                      }}
                    >
                      <h3 className="mb-2 text-sm font-semibold">Available options</h3>
                      <ul className="space-y-2">
                        {options
                          .filter(([key]) => !priority.includes(key))
                          .map(([key, label]) => (
                            <li
                              key={key}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', key);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                const source = event.dataTransfer.getData('text/plain');
                                if (source && source !== key) {
                                  const next = [...priority];
                                  const sourceIndex = next.indexOf(source);
                                  if (sourceIndex >= 0) {
                                    next.splice(sourceIndex, 1);
                                    const targetIndex = next.indexOf(key);
                                    next.splice(
                                      targetIndex < 0 ? next.length : targetIndex,
                                      0,
                                      source,
                                    );
                                    change('tournament_config', {
                                      ...v.tournament_config,
                                      ranking_priority:
                                        v.tournament_format === 'team'
                                          ? ['points', ...next.filter((item) => item !== 'points')]
                                          : next,
                                    });
                                  }
                                }
                              }}
                              className="flex items-center justify-between rounded-md bg-secondary/40 p-2 text-sm"
                            >
                              <span className="cursor-grab">⠿ {label}</span>
                              <button
                                type="button"
                                aria-label={`Add ${label} priority`}
                                onClick={() =>
                                  change('tournament_config', {
                                    ...v.tournament_config,
                                    ranking_priority: [...priority, key],
                                  })
                                }
                                className="rounded border px-2"
                              >
                                +
                              </button>
                            </li>
                          ))}
                        {options.every(([key]) => priority.includes(key)) && (
                          <li className="text-sm text-muted-foreground">All options selected.</li>
                        )}
                      </ul>
                    </div>
                  </div>
                );
              })()}
            </fieldset>
          )}
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-medium">Tournament rules</label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => change('tournament_rules_html', generateRulesText(v))}
              >
                Generate rules text
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Add text version of the rules here.</p>
            <TournamentRulesEditor
              value={v.tournament_rules_html}
              onChange={(html) => change('tournament_rules_html', html)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.allow_non_member_registration}
              onChange={(e) => change('allow_non_member_registration', e.target.checked)}
            />
            Allow non-member registration without creating accounts
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.tournament_details_public}
              onChange={(e) => change('tournament_details_public', e.target.checked)}
            />
            Publish tournament participants, teams, schedule, and results publicly
          </label>
          {v.event_type === 'tournament' && recurring && (
            <p role="alert" className="text-sm text-destructive">
              Tournament events cannot be recurring. Turn off repeat-event to continue.
            </p>
          )}
        </section>
      )}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Scheduling</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set event times and registration availability.
            </p>
          </div>
          {!v.id && v.event_type === 'social' && (
            <div
              className="inline-flex shrink-0 rounded-md border border-border p-1"
              role="group"
              aria-label="Event scheduling type"
            >
              {[
                ['single', 'Single event'],
                ['series', 'Series of events'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={recurring === (value === 'series')}
                  onClick={() => {
                    const seriesMode = value === 'series';
                    if (seriesMode) {
                      if (v.starts_at) {
                        setSeriesStartDate(v.starts_at.slice(0, 10));
                        setDayOfWeek(String(new Date(v.starts_at).getDay()));
                        setSeriesStartTime(v.starts_at.slice(11, 16));
                      }
                      if (v.ends_at) setSeriesEndTime(v.ends_at.slice(11, 16));
                    } else if (firstSeriesDate) {
                      const sessionDate = firstSeriesDate.toISOString().slice(0, 10);
                      change('starts_at', `${sessionDate}T${seriesStartTime}`);
                      change('ends_at', `${sessionDate}T${seriesEndTime}`);
                      const openDate = new Date(firstSeriesDate);
                      openDate.setDate(openDate.getDate() - Number(openDays));
                      const closeDate = new Date(firstSeriesDate);
                      closeDate.setDate(closeDate.getDate() - Number(closeDays));
                      change(
                        'registration_opens_at',
                        `${openDate.toISOString().slice(0, 10)}T${openTime}`,
                      );
                      change(
                        'registration_closes_at',
                        `${closeDate.toISOString().slice(0, 10)}T${closeTime}`,
                      );
                    }
                    setRecurring(seriesMode);
                  }}
                  className={`rounded px-3 py-2 text-sm ${recurring === (value === 'series') ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {v.event_type === 'tournament' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Approximate match length for scheduling (minutes)
              <Input
                type="number"
                min="30"
                max="240"
                value={v.tournament_config.schedule?.match_minutes ?? 60}
                onChange={(e) =>
                  change('tournament_config', {
                    ...v.tournament_config,
                    schedule: {
                      ...v.tournament_config.schedule,
                      match_minutes: Number(e.target.value) || 60,
                    },
                  })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              Break between matches (minutes)
              <Input
                type="number"
                min="10"
                max="60"
                value={v.tournament_config.schedule?.break_minutes ?? 15}
                onChange={(e) =>
                  change('tournament_config', {
                    ...v.tournament_config,
                    schedule: {
                      ...v.tournament_config.schedule,
                      break_minutes: Number(e.target.value) || 15,
                    },
                  })
                }
              />
            </label>
          </div>
        )}
        {!recurring ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              {v.event_type === 'tournament' ? 'Tournament starts' : 'Event starts'}
              <Input
                type="datetime-local"
                required
                value={v.starts_at}
                onChange={(e) => change('starts_at', e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              {v.event_type === 'tournament' ? 'Tournament ends' : 'Event ends'}
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
                value={v.registration_opens_at}
                onChange={(e) => change('registration_opens_at', e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Registration cutoff
              <Input
                type="datetime-local"
                required
                value={v.registration_closes_at}
                onChange={(e) => change('registration_closes_at', e.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
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
                Day of week
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(e.target.value)}
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                >
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                Start date
                <Input
                  type="date"
                  required
                  value={seriesStartDate}
                  onChange={(e) => setSeriesStartDate(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Repeat until
                <Input
                  type="date"
                  required
                  value={until}
                  min={seriesStartDate}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Start time
                <Input
                  type="time"
                  required
                  value={seriesStartTime}
                  onChange={(e) => setSeriesStartTime(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                End time
                <Input
                  type="time"
                  required
                  value={seriesEndTime}
                  onChange={(e) => setSeriesEndTime(e.target.value)}
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 text-sm">
                <label className="font-medium" htmlFor="series-open-days">
                  Open registration days before
                </label>
                <Input
                  id="series-open-days"
                  type="number"
                  min="0"
                  max="180"
                  value={openDays}
                  onChange={(e) => setOpenDays(e.target.value)}
                />
                {previewRegistrationDate(openDays) && (
                  <p className="text-xs text-muted-foreground">
                    Registration opens on {previewRegistrationDate(openDays)} at{' '}
                    {formatClockTime(openTime)}.
                  </p>
                )}
              </div>
              <label className="space-y-1 text-sm">
                Registration opening time
                <Input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} />
              </label>
              <div className="space-y-1 text-sm">
                <label className="font-medium" htmlFor="series-close-days">
                  Registration cutoff days before
                </label>
                <Input
                  id="series-close-days"
                  type="number"
                  min="0"
                  max="180"
                  value={closeDays}
                  onChange={(e) => setCloseDays(e.target.value)}
                />
                {previewRegistrationDate(closeDays) && (
                  <p className="text-xs text-muted-foreground">
                    Registration closes on {previewRegistrationDate(closeDays)} at{' '}
                    {formatClockTime(closeTime)}.
                  </p>
                )}
              </div>
              <label className="space-y-1 text-sm">
                Registration cutoff time
                <Input
                  type="time"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                />
              </label>
            </div>
          </>
        )}
      </section>

      <Button disabled={busy}>
        {busy ? (
          <TennisLoader compact label="Saving" />
        ) : v.id ? (
          'Save event changes'
        ) : recurring ? (
          'Create events'
        ) : v.event_type === 'tournament' ? (
          'Create tournament'
        ) : (
          'Create event'
        )}
      </Button>
    </form>
  );
}
