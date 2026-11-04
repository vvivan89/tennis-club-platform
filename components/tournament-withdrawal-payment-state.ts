import type {
  OwnTournamentEntry,
  Pair,
  PairPaymentStatus,
} from '@/components/tournament-public-view-types';

export function getTournamentWithdrawalPaymentState(
  withdrawTarget: string | null,
  ownEntries: OwnTournamentEntry[],
  pairs: Pair[],
  pairPaymentStatuses: PairPaymentStatus[],
) {
  const withdrawEntry = ownEntries.find((entry) => entry.id === withdrawTarget);
  const withdrawPair = withdrawEntry
    ? pairs.find(
        (pair) =>
          pair.status !== 'withdrawn' &&
          pair.category === withdrawEntry.category &&
          (pair.player_one_id === withdrawEntry.id || pair.player_two_id === withdrawEntry.id),
      )
    : undefined;
  const withdrawPairPayment = withdrawPair
    ? pairPaymentStatuses.find((status) => status.pair_id === withdrawPair.id)
    : undefined;
  const withdrawEitherPartnerPaid =
    !!withdrawPairPayment &&
    ['paid', 'not_required'].some((status) =>
      [
        withdrawPairPayment.player_one_payment_status,
        withdrawPairPayment.player_two_payment_status,
      ].includes(status),
    );
  const withdrawPaidTeam = Boolean(
    withdrawEntry?.confirmation_status === 'confirmed' &&
    withdrawEntry.partner_confirmation_status === 'confirmed' &&
    withdrawEitherPartnerPaid,
  );

  return { withdrawEntry, withdrawPaidTeam };
}
