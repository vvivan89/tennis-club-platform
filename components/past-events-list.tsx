'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { eventPath } from '@/lib/event-slug';
import { eventDateLabel as dateLabel } from '@/lib/event-format';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
type EventRow = {
  id: string;
  slug?: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  registration_opens_at: string;
  registration_closes_at: string | null;
  capacity: number;
  price_cents: number;
  members_only: boolean;
  status: string;
  event_type: string;
};
export function PastEventsList({ events }: { events: EventRow[] }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () =>
      events
        .filter((e) =>
          `${e.title} ${e.description || ''} ${e.status}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
    [events, query],
  );
  return (
    <details className="mt-12 rounded-xl border border-border p-5">
      <summary className="cursor-pointer text-lg font-semibold">
        Past events ({events.length})
      </summary>
      <div className="mt-4">
        <label className="mb-3 block text-sm">
          Search past events
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by event title…"
            className="mt-1 max-w-md"
          />
        </label>
        {filtered.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((event) => (
              <Card key={event.id} className="overflow-hidden rounded-xl border-border/80">
                <Link href={eventPath(event)} className="block">
                  <div className="flex items-start justify-between p-4 bg-muted">
                    <span />
                    <Badge
                      variant="outline"
                      className={event.status === 'cancelled' ? 'text-destructive' : ''}
                    >
                      {event.status === 'cancelled' ? 'Cancelled' : 'Past event'}
                    </Badge>
                  </div>
                  <CardHeader className="pb-2">
                    <p className="text-xs text-muted-foreground">{dateLabel(event.starts_at)}</p>
                    <h3 className="text-xl font-medium">{event.title}</h3>
                  </CardHeader>
                  {event.description?.trim() && (
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{event.description.trim()}</p>
                    </CardContent>
                  )}
                </Link>
              </Card>
            ))}
          </div>
        ) : (
          <p className="py-5 text-sm text-muted-foreground">No past events match your search.</p>
        )}
      </div>
    </details>
  );
}
