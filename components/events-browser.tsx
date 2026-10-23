'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, ChevronLeft, ChevronRight } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EventCardActions } from '@/components/event-card-actions';
import { EventCardWeather } from '@/components/event-card-weather';
import { PastEventsList } from '@/components/past-events-list';
import { eventPath } from '@/lib/event-slug';

type EventRow = {
  id: string;
  slug?: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at?: string | null;
  registration_opens_at: string;
  registration_closes_at: string | null;
  capacity: number;
  price_cents: number;
  members_only: boolean;
  status: string;
  event_type: string;
  location?: string | null;
};
type CountRow = { event_id: string; confirmed_count: number };
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
function money(cents: number, membersOnly: boolean) {
  return cents === 0
    ? membersOnly
      ? 'Free for members'
      : 'Free'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}
function weekStart(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
export function EventsBrowser({
  events,
  pastEvents = [],
  counts,
  defaultLocation,
}: {
  events: EventRow[];
  pastEvents?: EventRow[];
  counts: CountRow[];
  defaultLocation: string;
}) {
  const [view, setView] = useState<'cards' | 'calendar'>('cards');
  const [calendarMode, setCalendarMode] = useState<'month' | 'week'>('month');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [myRegistrations, setMyRegistrations] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    async function loadRegistrations() {
      const db = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) {
        if (active) setMyRegistrations({});
        return;
      }
      const { data } = await db
        .from('registrations')
        .select('event_id,status')
        .eq('user_id', user.id)
        .in('status', ['confirmed', 'waitlisted']);
      if (active)
        setMyRegistrations(Object.fromEntries((data ?? []).map((r) => [r.event_id, r.status])));
    }
    void loadRegistrations();
    return () => {
      active = false;
    };
  }, []);
  const now = Date.now();
  const thisWeekStart = weekStart(new Date());
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const weekAfterNext = new Date(nextWeekStart);
  weekAfterNext.setDate(weekAfterNext.getDate() + 7);
  const thisWeekEvents = events
    .filter((e) => {
      const start = new Date(e.starts_at).getTime();
      const end = new Date(e.ends_at || e.starts_at).getTime();
      const ongoing = start <= now && end >= now;
      return ongoing || (start >= thisWeekStart.getTime() && start < nextWeekStart.getTime());
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const showNextWeek = thisWeekEvents.length === 0;
  const featuredTitle = showNextWeek ? 'Next week' : 'This week';
  const featuredEvents = showNextWeek
    ? events
        .filter(
          (e) => new Date(e.starts_at) >= nextWeekStart && new Date(e.starts_at) < weekAfterNext,
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : thisWeekEvents;
  const featuredIds = new Set(featuredEvents.map((e) => e.id));
  const otherEvents = events
    .filter((e) => !featuredIds.has(e.id))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const countFor = (id: string) => counts.find((c) => c.event_id === id)?.confirmed_count ?? 0;
  const monthFirstDay = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
  const monthOffset = (monthFirstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth() + 1,
    0,
  ).getDate();
  const monthCells = Array.from(
    { length: Math.ceil((monthOffset + daysInMonth) / 7) * 7 },
    (_, i) => {
      const n = i - monthOffset + 1;
      return n < 1 || n > daysInMonth
        ? null
        : new Date(calendarDate.getFullYear(), calendarDate.getMonth(), n);
    },
  );
  const weekFirstDay = weekStart(calendarDate);
  const weekCells = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekFirstDay);
    d.setDate(d.getDate() + i);
    return d;
  });
  const calendarCells = calendarMode === 'month' ? monthCells : weekCells;
  const calendarTitle =
    calendarMode === 'month'
      ? new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric' }).format(calendarDate)
      : `${new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(weekCells[0])} – ${new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(weekCells[6])}`;
  const calendarEvents = [...events, ...pastEvents];
  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of calendarEvents) {
      const d = new Date(e.starts_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      map.set(
        key,
        [...(map.get(key) || []), e].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      );
    }
    return map;
  }, [events, pastEvents]);
  const renderCards = (items: EventRow[]) =>
    items.length ? (
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((event, i) => {
          const current = Date.now();
          const registrationOpen =
            event.status === 'published' &&
            current >= new Date(event.registration_opens_at).getTime() &&
            (!event.registration_closes_at ||
              current < new Date(event.registration_closes_at).getTime());
          return (
            <Card
              key={event.id}
              className="group overflow-hidden rounded-xl border-border/80 transition-all duration-200 hover:-translate-y-1 hover:shadow-soft"
            >
              <Link
                href={eventPath(event)}
                className="block rounded-t-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <EventCardWeather
                  startsAt={event.starts_at}
                  location={defaultLocation.trim() || event.location?.trim() || ''}
                  status={event.status}
                  index={i}
                />
                <CardHeader className="pb-2">
                  <p className="flex items-center gap-2 text-xs font-medium text-brand-court">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {dateLabel(event.starts_at)}
                  </p>
                  <h2 className="pt-1 text-2xl font-medium group-hover:text-primary">
                    {event.title}
                  </h2>
                  {new Date(event.starts_at).getTime() <= current &&
                    new Date(event.ends_at || event.starts_at).getTime() >= current && (
                      <span className="mt-2 inline-flex rounded-full bg-emerald-600/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        In progress
                      </span>
                    )}
                </CardHeader>
                <CardContent className="pb-4">
                  <p className="min-h-12 text-sm leading-6 text-muted-foreground">
                    {event.description?.trim() || ''}
                  </p>
                  <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {event.status === 'cancelled'
                      ? 'This event has been cancelled.'
                      : registrationOpen
                        ? event.registration_closes_at
                          ? `Registration closes ${dateLabel(event.registration_closes_at)}`
                          : 'Registration is open'
                        : current < new Date(event.registration_opens_at).getTime()
                          ? `Registration opens ${dateLabel(event.registration_opens_at)}`
                          : 'Registration is closed'}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {Math.max(0, event.capacity - countFor(event.id))} spots remaining
                  </p>
                </CardContent>
              </Link>
              <CardContent className="flex items-center justify-between gap-3 border-t border-border pt-4">
                <span className="text-sm font-semibold">
                  {money(event.price_cents, event.members_only)}
                </span>
                {event.status === 'published' && <EventCardActions eventId={event.id} />}
              </CardContent>
            </Card>
          );
        })}
        <p className="col-span-full text-xs text-muted-foreground">
          Weather data by{' '}
          <a
            href="https://open-meteo.com/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Open-Meteo.com
          </a>
          . Forecast values and icons are summarized for display under{' '}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            CC BY 4.0
          </a>
          .
        </p>
      </div>
    ) : (
      <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
        There are no events in this period.
      </div>
    );
  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {events.length} upcoming event{events.length === 1 ? '' : 's'}
        </p>
        <div className="flex gap-1 rounded-lg border border-border p-1" aria-label="Event view">
          <Button
            type="button"
            size="sm"
            variant={view === 'cards' ? 'secondary' : 'ghost'}
            onClick={() => setView('cards')}
          >
            Card view
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'calendar' ? 'secondary' : 'ghost'}
            onClick={() => setView('calendar')}
          >
            Calendar view
          </Button>
        </div>
      </div>
      {view === 'cards' ? (
        <>
          <div className="space-y-4">
            <details open className="group rounded-xl border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-lg font-semibold marker:hidden">
                <span>
                  {featuredTitle}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({featuredEvents.length})
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-muted-foreground transition-transform group-open:rotate-180"
                >
                  ⌄
                </span>
              </summary>
              <div className="border-t border-border p-4 sm:p-5">{renderCards(featuredEvents)}</div>
            </details>
            <details className="group rounded-xl border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-lg font-semibold marker:hidden">
                <span>
                  All scheduled events
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({otherEvents.length})
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-muted-foreground transition-transform group-open:rotate-180"
                >
                  ⌄
                </span>
              </summary>
              <div className="border-t border-border p-4 sm:p-5">{renderCards(otherEvents)}</div>
            </details>
          </div>
          {pastEvents.length > 0 && <PastEventsList events={pastEvents} />}
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label={calendarMode === 'month' ? 'Previous month' : 'Previous week'}
                onClick={() =>
                  setCalendarDate((d) => {
                    const next = new Date(d);
                    if (calendarMode === 'month') next.setMonth(next.getMonth() - 1);
                    else next.setDate(next.getDate() - 7);
                    return next;
                  })
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="min-w-36 text-center font-semibold">{calendarTitle}</h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label={calendarMode === 'month' ? 'Next month' : 'Next week'}
                onClick={() =>
                  setCalendarDate((d) => {
                    const next = new Date(d);
                    if (calendarMode === 'month') next.setMonth(next.getMonth() + 1);
                    else next.setDate(next.getDate() + 7);
                    return next;
                  })
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {(calendarMode === 'month'
                ? calendarDate.getFullYear() !== new Date().getFullYear() ||
                  calendarDate.getMonth() !== new Date().getMonth()
                : weekStart(calendarDate).getTime() !== weekStart(new Date()).getTime()) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCalendarDate(new Date())}
                >
                  Today
                </Button>
              )}
            </div>
            <div
              className="flex items-center gap-1 rounded-md border border-border p-1"
              aria-label="Calendar period"
            >
              <Button
                type="button"
                size="sm"
                variant={calendarMode === 'month' ? 'secondary' : 'ghost'}
                onClick={() => setCalendarMode('month')}
              >
                Month
              </Button>
              <Button
                type="button"
                size="sm"
                variant={calendarMode === 'week' ? 'secondary' : 'ghost'}
                onClick={() => setCalendarMode('week')}
              >
                Week
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-b border-border px-3 py-3 text-xs">
            <span className="font-semibold text-muted-foreground">Legend</span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-gray-500" />
              Past
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />
              Not open
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-green-600" />
              Spots available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
              Full / waitlist
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />
              You’re confirmed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-violet-600" />
              You’re waitlisted
            </span>
          </div>
          <div className="grid grid-cols-7 border-b border-border bg-muted/60">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarCells.map((date, i) => {
              if (!date)
                return (
                  <div
                    key={`blank-${i}`}
                    className="min-h-24 border-b border-r border-border/70 bg-muted/10 sm:min-h-32"
                  />
                );
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const dayEvents = byDay.get(key) || [];
              return (
                <div
                  key={key}
                  className={`${calendarMode === 'week' ? 'min-h-36 sm:min-h-56' : 'min-h-24 sm:min-h-32'} border-b border-r border-border/70 p-1.5 sm:p-2 ${date.getFullYear() === new Date().getFullYear() && date.getMonth() === new Date().getMonth() && date.getDate() === new Date().getDate() ? 'bg-primary/5 ring-2 ring-inset ring-primary/70' : ''}`}
                >
                  <span
                    className={`inline-flex min-w-5 items-center justify-center rounded-full text-xs ${date.getFullYear() === new Date().getFullYear() && date.getMonth() === new Date().getMonth() && date.getDate() === new Date().getDate() ? 'bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    {calendarMode === 'week'
                      ? new Intl.DateTimeFormat('en-CA', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        }).format(date)
                      : date.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayEvents.map((e) => {
                      const registration = myRegistrations[e.id];
                      const now = Date.now();
                      const isPast = now > new Date(e.ends_at || e.starts_at).getTime();
                      const isOpen =
                        e.status === 'published' &&
                        now >= new Date(e.registration_opens_at).getTime() &&
                        (!e.registration_closes_at ||
                          now < new Date(e.registration_closes_at).getTime());
                      const isFull = countFor(e.id) >= e.capacity;
                      const color = isPast
                        ? 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                        : e.status === 'cancelled'
                          ? 'bg-red-600/15 text-red-700 dark:text-red-300'
                          : registration === 'confirmed'
                            ? 'bg-blue-600/15 text-blue-700 dark:text-blue-300'
                            : registration === 'waitlisted'
                              ? 'bg-violet-600/15 text-violet-700 dark:text-violet-300'
                              : isOpen && isFull
                                ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                                : isOpen
                                  ? 'bg-green-600/15 text-green-700 dark:text-green-300'
                                  : 'bg-slate-300/45 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300';
                      return (
                        <Link
                          key={e.id}
                          href={eventPath(e)}
                          title={`${dateLabel(e.starts_at)} · ${e.title}`}
                          className={`block truncate rounded px-1.5 py-1 text-[10px] leading-4 hover:underline sm:text-xs ${color}`}
                        >
                          {new Date(e.starts_at).toLocaleTimeString('en-CA', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}{' '}
                          {e.title}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="border-t border-border p-3 text-xs text-muted-foreground">
            Click on the event to view details.
          </p>
        </div>
      )}
    </section>
  );
}
