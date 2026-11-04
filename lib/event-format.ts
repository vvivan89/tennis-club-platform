export type EventRow = {
  id: string;
  series_id?: string | null;
  series_number?: number | null;
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
  allow_plus_one?: boolean;
  guest_price_cents?: number;
  location?: string | null;
};

export type EventSeriesSession = Pick<EventRow, 'id' | 'starts_at' | 'series_id'>;
type EventSeriesLookupClient = {
  from: (table: 'events') => {
    select: (columns: 'id,series_id,starts_at') => {
      in: (
        column: 'series_id',
        seriesIds: string[],
      ) => PromiseLike<{ data: EventSeriesSession[] | null }>;
    };
  };
};

export function withEventSeriesNumbers<T extends EventSeriesSession>(
  events: T[],
  seriesSessions: EventSeriesSession[] = events,
): Array<T & { series_number: number | null }> {
  const orderedSeries = new Map<string, EventSeriesSession[]>();
  for (const session of seriesSessions) {
    if (!session.series_id) continue;
    const group = orderedSeries.get(session.series_id) ?? [];
    group.push(session);
    orderedSeries.set(session.series_id, group);
  }
  for (const group of orderedSeries.values()) {
    group.sort(
      (left, right) =>
        left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id),
    );
  }

  return events.map((event) => {
    if (!event.series_id) return { ...event, series_number: null };
    const index = orderedSeries
      .get(event.series_id)
      ?.findIndex((session) => session.id === event.id);
    return { ...event, series_number: index === undefined || index < 0 ? null : index + 1 };
  });
}

/** Loads each represented series once, then numbers events against all its sessions. */
export async function withLoadedEventSeriesNumbers<T extends EventSeriesSession>(
  events: T[],
  database: unknown,
) {
  const seriesIds = [
    ...new Set(events.map((event) => event.series_id).filter(Boolean)),
  ] as string[];
  const db = database as EventSeriesLookupClient;
  const { data: sessions } = seriesIds.length
    ? await db.from('events').select('id,series_id,starts_at').in('series_id', seriesIds)
    : { data: [] as EventSeriesSession[] };
  return withEventSeriesNumbers(events, sessions ?? []);
}

export function eventDisplayTitle(event: Pick<EventRow, 'title' | 'series_number'>) {
  return event.series_number ? `${event.title} #${event.series_number}` : event.title;
}

export function eventCardPriceLabel(
  event: Pick<
    EventRow,
    'price_cents' | 'members_only' | 'event_type' | 'allow_plus_one' | 'guest_price_cents'
  >,
) {
  const memberPrice = eventPriceLabel(event.price_cents, event.members_only);
  if (event.event_type !== 'party') return memberPrice;
  const guestPrice = !event.allow_plus_one
    ? ''
    : event.guest_price_cents
      ? ` · +${eventPriceLabel(event.guest_price_cents, false)} per guest`
      : ' · +1 guest included';
  return `${memberPrice} per member${guestPrice}`;
}

export function eventDateLabel(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function eventDateRangeLabel(startsAt: string, endsAt?: string | null) {
  if (!endsAt) return eventDateLabel(startsAt);

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (!sameDay) return `${eventDateLabel(startsAt)} - ${eventDateLabel(endsAt)}`;

  const endTime = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(end);
  return `${eventDateLabel(startsAt)} - ${endTime}`;
}

export function eventPriceLabel(cents: number, membersOnly: boolean) {
  return cents === 0
    ? membersOnly
      ? 'Free for members'
      : 'Free'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

export function formatCadPrice(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}
