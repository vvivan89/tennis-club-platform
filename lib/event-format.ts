export type EventRow = {
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

export function eventPriceLabel(cents: number, membersOnly: boolean) {
  return cents === 0
    ? membersOnly
      ? 'Free for members'
      : 'Free'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}
