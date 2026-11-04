import { formatDateTime } from '@/lib/time-format';

export const categoryLabel = (value: string) =>
  ({
    mixed: 'Mixed doubles',
    men: "Men's doubles",
    women: "Women's doubles",
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
