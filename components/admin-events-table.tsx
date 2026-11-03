'use client';

import { formatDateTime } from '@/lib/time-format';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { eventEditPath } from '@/lib/event-slug';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { eventDisplayTitle } from '@/lib/event-format';
import { FloatingFeedback } from '@/components/floating-feedback';

type AdminEvent = {
  id: string;
  slug?: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  capacity: number;
  price_cents: number;
  series_id: string | null;
  series_number?: number | null;
  created_by?: string | null;
  organizer_id?: string | null;
  event_type?: string | null;
  tournament_format?: string | null;
  social_doubles_ladder_id?: string | null;
  is_league_tournament?: boolean;
};

function typeLabel(event: AdminEvent) {
  if (event.is_league_tournament) return 'League';
  if (event.event_type === 'social_doubles_ladder' || event.event_type === 'ladder')
    return 'Social doubles ladder';
  if (event.event_type !== 'tournament') return 'Social event';
  return event.tournament_format === 'team' ? 'Team tournament' : 'Doubles tournament';
}

const inputClass = 'mt-1 block h-10 w-full rounded-md border border-input bg-background px-3';

export function AdminEventsTable({ events }: { events: AdminEvent[] }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [price, setPrice] = useState('all');
  const [status, setStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [period, setPeriod] = useState<'future' | 'past'>('future');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [eventToDelete, setEventToDelete] = useState<AdminEvent | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const now = Date.now();
  // The Future tab includes events that have started but have not finished yet.
  const isFuture = (event: AdminEvent) => {
    const relevantEnd = new Date(event.ends_at ?? event.starts_at).getTime();
    return Number.isFinite(relevantEnd) && relevantEnd >= now;
  };
  const canEdit = (event: AdminEvent) => {
    const finishedAt = new Date(event.ends_at ?? event.starts_at).getTime();
    const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
    // Ongoing events remain editable. After they finish, allow exactly 48 hours.
    return Number.isFinite(finishedAt) && (now <= finishedAt || now - finishedAt <= twoDaysInMs);
  };
  async function deleteEvent(event: AdminEvent) {
    setBusyId(event.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/admin/events/${event.id}/delete`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete event.');
      setMessage('Event deleted successfully.');
      startTransition(() => router.refresh());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete event.');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(
    () =>
      events
        .filter((event) => {
          if ((period === 'future') !== isFuture(event)) return false;
          const eventType = event.is_league_tournament
            ? 'league'
            : event.event_type === 'social_doubles_ladder' || event.event_type === 'ladder'
              ? 'ladder'
              : event.event_type !== 'tournament'
                ? 'social'
                : event.tournament_format === 'team'
                  ? 'team'
                  : 'doubles';
          const day = event.starts_at.slice(0, 10);
          return (
            eventDisplayTitle(event).toLowerCase().includes(search.trim().toLowerCase()) &&
            (type === 'all' || type === eventType) &&
            (price === 'all' ||
              (price === 'free' ? event.price_cents === 0 : event.price_cents > 0)) &&
            (status === 'all' || event.status === status) &&
            (!dateFrom || day >= dateFrom) &&
            (!dateTo || day <= dateTo)
          );
        })
        .sort((a, b) =>
          period === 'future'
            ? new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
            : 0,
        ),
    [events, search, type, price, status, dateFrom, dateTo, period],
  );

  const statuses = [...new Set(events.map((event) => event.status))].sort();

  return (
    <div className="mt-7 space-y-4">
      <FloatingFeedback message={message} />
      <div
        role="group"
        aria-label="Event time period"
        className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
      >
        {(
          [
            { value: 'future', label: 'Future events' },
            { value: 'past', label: 'Past events' },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={period === option.value}
            onClick={() => setPeriod(option.value)}
            className={`rounded-md px-4 py-2 text-sm ${period === option.value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="text-sm">
          Search by name
          <input
            aria-label="Search events by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Event name"
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          Type
          <select
            aria-label="Filter by type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className={inputClass}
          >
            <option value="all">All types</option>
            <option value="social">Social event</option>
            <option value="ladder">Social doubles ladder</option>
            <option value="league">League</option>
            <option value="doubles">Doubles tournament</option>
            <option value="team">Team tournament</option>
          </select>
        </label>
        <label className="text-sm">
          Price
          <select
            aria-label="Filter by price"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            className={inputClass}
          >
            <option value="all">All prices</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label className="text-sm">
          Status
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={inputClass}
          >
            <option value="all">All statuses</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {value[0]?.toUpperCase()}
                {value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Starts on or after
          <input
            aria-label="Start date from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          Starts on or before
          <input
            aria-label="Start date to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              {[
                'Event',
                'Type',
                'Starts',
                'Ends',
                'Capacity',
                'Price',
                'Status',
                'Series',
                'Actions',
              ].map((label) => (
                <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((event) => (
              <tr key={event.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{eventDisplayTitle(event)}</td>
                <td className="whitespace-nowrap px-4 py-3">{typeLabel(event)}</td>
                <td className="whitespace-nowrap px-4 py-3">{formatDateTime(event.starts_at)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {event.ends_at ? formatDateTime(event.ends_at) : '—'}
                </td>
                <td className="px-4 py-3">{event.capacity}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {event.price_cents === 0
                    ? 'Free'
                    : new Intl.NumberFormat('en-CA', {
                        style: 'currency',
                        currency: 'CAD',
                      }).format(event.price_cents / 100)}
                </td>
                <td className="px-4 py-3 capitalize">{event.status}</td>
                <td className="px-4 py-3">{event.series_id ? 'Recurring' : 'One-off'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {canEdit(event) && (
                      <Button
                        asChild
                        size="icon"
                        variant="outline"
                        aria-label={`Edit ${eventDisplayTitle(event)}`}
                        title="Edit event"
                      >
                        <Link href={eventEditPath(event)}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    {isFuture(event) && (
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={`Delete ${eventDisplayTitle(event)}`}
                        title="Delete event"
                        disabled={busyId === event.id}
                        onClick={() => setEventToDelete(event)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-4 text-sm text-muted-foreground">No events match these filters.</p>
        )}
      </div>
      <ConfirmDialog
        open={eventToDelete !== null}
        title="Delete event?"
        description={
          eventToDelete ? (
            <>
              Are you sure you want to delete <strong>{eventDisplayTitle(eventToDelete)}</strong>?
              This action cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete event"
        destructive
        busy={busyId !== null}
        onCancel={() => {
          if (busyId === null) setEventToDelete(null);
        }}
        onConfirm={() => {
          if (eventToDelete)
            void deleteEvent(eventToDelete).then((deleted) => {
              if (deleted) setEventToDelete(null);
            });
        }}
      />
    </div>
  );
}
