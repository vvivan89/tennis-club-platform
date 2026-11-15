import type {
  TournamentRegistrationDiscounts,
  TournamentRegistrationDiscountRule,
} from '@/lib/tournament-config';

function discountLabel(rule: TournamentRegistrationDiscountRule | undefined) {
  if (!rule?.enabled) return null;
  if (rule.type === 'fixed') {
    return (rule.amount_cents ?? 0) > 0
      ? `$${((rule.amount_cents ?? 0) / 100).toFixed(2)} off`
      : null;
  }
  return (rule.percent ?? 0) > 0 ? `${rule.percent}% off` : null;
}

export function TournamentRegistrationDiscountSummary({
  discounts,
  format,
  leagueTournament,
}: {
  discounts: TournamentRegistrationDiscounts | undefined;
  format: string | null;
  leagueTournament: boolean;
}) {
  if (leagueTournament || !discounts) return null;
  const items = [
    ...(format === 'doubles' && discountLabel(discounts.second_category)
      ? [`Second category: ${discountLabel(discounts.second_category)}`]
      : []),
    ...(format === 'doubles' && discountLabel(discounts.pair_registration)
      ? [`Pair registration: ${discountLabel(discounts.pair_registration)} per eligible player`]
      : []),
    ...(discountLabel(discounts.approved_member)
      ? [`Approved club members: ${discountLabel(discounts.approved_member)}`]
      : []),
  ];
  if (!items.length) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Discounts: {items.join(' · ')}.{' '}
      {discounts.stack_enabled
        ? 'Eligible discounts stack.'
        : 'Only the largest eligible discount applies.'}
    </p>
  );
}
