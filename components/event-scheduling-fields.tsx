import { Input } from '@/components/ui/input';
import type { EventFormValues } from '@/components/event-form-types';
import { formatClockTime } from '@/lib/time-format';

type ChangeValue = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => void;

export function EventSchedulingFields({
  v,
  change,
  recurring,
  setRecurring,
  frequency,
  setFrequency,
  dayOfWeek,
  setDayOfWeek,
  seriesStartDate,
  setSeriesStartDate,
  until,
  setUntil,
  seriesStartTime,
  setSeriesStartTime,
  seriesEndTime,
  setSeriesEndTime,
  openDays,
  setOpenDays,
  closeDays,
  setCloseDays,
  openTime,
  setOpenTime,
  closeTime,
  setCloseTime,
  seedSeriesFromEvent,
  firstSeriesDate,
  previewRegistrationDate,
}: {
  v: EventFormValues;
  change: ChangeValue;
  recurring: boolean;
  setRecurring: (value: boolean) => void;
  frequency: string;
  setFrequency: (value: string) => void;
  dayOfWeek: string;
  setDayOfWeek: (value: string) => void;
  seriesStartDate: string;
  setSeriesStartDate: (value: string) => void;
  until: string;
  setUntil: (value: string) => void;
  seriesStartTime: string;
  setSeriesStartTime: (value: string) => void;
  seriesEndTime: string;
  setSeriesEndTime: (value: string) => void;
  openDays: string;
  setOpenDays: (value: string) => void;
  closeDays: string;
  setCloseDays: (value: string) => void;
  openTime: string;
  setOpenTime: (value: string) => void;
  closeTime: string;
  setCloseTime: (value: string) => void;
  seedSeriesFromEvent: () => void;
  firstSeriesDate: Date | null;
  previewRegistrationDate: (days: string) => string | null;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Scheduling</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {v.is_league_tournament
              ? 'Schedule connected League events using the existing event series controls.'
              : 'Set event times and registration availability.'}
          </p>
        </div>
        {!v.id &&
          (['social', 'social_doubles_ladder'].includes(v.event_type) ||
            (v.event_type === 'tournament' && v.is_league_tournament)) && (
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
                      seedSeriesFromEvent();
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
      {v.event_type === 'tournament' && !v.is_league_tournament && (
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
            {v.event_type === 'tournament' && !v.is_league_tournament
              ? 'Tournament starts'
              : 'Event starts'}
            <Input
              type="datetime-local"
              required
              value={v.starts_at}
              onChange={(e) => change('starts_at', e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            {v.event_type === 'tournament' && !v.is_league_tournament
              ? 'Tournament ends'
              : 'Event ends'}
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
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ),
                )}
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
              <Input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
            </label>
          </div>
        </>
      )}
    </section>
  );
}
