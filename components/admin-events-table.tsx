'use client';

import { formatDateTime } from '@/lib/time-format';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { eventEditPath } from '@/lib/event-slug';

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
  created_by?: string | null;
  organizer_id?: string | null;
  event_type?: string | null;
  tournament_format?: string | null;
};

function typeLabel(event: AdminEvent) {
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

  const filtered = useMemo(
    () =>
      events.filter((event) => {
        const eventType =
          event.event_type !== 'tournament'
            ? 'social'
            : event.tournament_format === 'team'
              ? 'team'
              : 'doubles';
        const day = event.starts_at.slice(0, 10);
        return (
          event.title.toLowerCase().includes(search.trim().toLowerCase()) &&
          (type === 'all' || type === eventType) &&
          (price === 'all' ||
            (price === 'free' ? event.price_cents === 0 : event.price_cents > 0)) &&
          (status === 'all' || event.status === status) &&
          (!dateFrom || day >= dateFrom) &&
          (!dateTo || day <= dateTo)
        );
      }),
    [events, search, type, price, status, dateFrom, dateTo],
  );

  const statuses = [...new Set(events.map((event) => event.status))].sort();

  return (
    <div className="mt-7 space-y-4">
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
                <td className="px-4 py-3 font-medium">{event.title}</td>
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
                  <Button asChild size="sm" variant="outline">
                    <Link href={eventEditPath(event)}>Edit</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-4 text-sm text-muted-foreground">No events match these filters.</p>
        )}
      </div>
    </div>
  );
}
