import { formatDateTime } from '@/lib/time-format';

export const categoryLabel = (value: string, format?: string | null) =>
  ({
    mixed: 'Mixed doubles',
    men: format === 'singles' ? "Men's singles" : "Men's doubles",
    women: format === 'singles' ? "Women's singles" : "Women's doubles",
    all: 'All gender',
    team: 'Team tournament',
    overall: 'Overall',
  })[value] || value;

export const phaseLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export const dateLabel = (value: string | null) =>
  value ? formatDateTime(value) : 'Time to be announced';

export const formatMoney = (amountMinor: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amountMinor / 100);

export const tournamentPaymentActionKey = (
  participantIds: string[],
  provider: 'stripe' | 'interac' = 'stripe',
) => `${provider}:${[...new Set(participantIds)].sort().join(',')}`;
