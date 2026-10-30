export const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'canceled',
  'partially_refunded',
  'refunded',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentPurpose =
  'membership' | 'event_registration' | 'tournament_registration' | 'other';

const transitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['processing', 'succeeded', 'failed', 'canceled'],
  processing: ['succeeded', 'failed', 'canceled'],
  succeeded: ['partially_refunded', 'refunded'],
  failed: ['pending', 'processing', 'succeeded', 'canceled'],
  canceled: [],
  partially_refunded: ['refunded'],
  refunded: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) {
    throw new Error(`Invalid payment status transition: ${from} -> ${to}`);
  }
}

export function validatePaymentInput(input: {
  amountMinor: unknown;
  currency: unknown;
  purpose: unknown;
  userId?: unknown;
  businessRecordId?: unknown;
}): { amountMinor: number; currency: string; purpose: PaymentPurpose } {
  if (!Number.isSafeInteger(input.amountMinor) || (input.amountMinor as number) <= 0) {
    throw new Error('Payment amount must be a positive safe integer in minor currency units.');
  }
  if (typeof input.currency !== 'string' || !/^[a-zA-Z]{3}$/.test(input.currency)) {
    throw new Error('Currency must be a three-letter ISO currency code.');
  }
  if (
    !['membership', 'event_registration', 'tournament_registration', 'other'].includes(
      String(input.purpose),
    )
  ) {
    throw new Error('Unsupported payment purpose.');
  }
  if (input.userId !== undefined && input.userId !== null && typeof input.userId !== 'string') {
    throw new Error('User ID must be a string.');
  }
  if (
    input.businessRecordId !== undefined &&
    input.businessRecordId !== null &&
    typeof input.businessRecordId !== 'string'
  ) {
    throw new Error('Business record ID must be a string.');
  }
  return {
    amountMinor: input.amountMinor as number,
    currency: input.currency.toLowerCase(),
    purpose: input.purpose as PaymentPurpose,
  };
}

export function mapStripePaymentStatus(
  eventType: string,
  current: PaymentStatus,
): PaymentStatus | null {
  switch (eventType) {
    case 'payment_intent.processing':
      return canTransitionPayment(current, 'processing') ? 'processing' : null;
    case 'payment_intent.succeeded':
      return canTransitionPayment(current, 'succeeded') ? 'succeeded' : null;
    case 'payment_intent.payment_failed':
      return canTransitionPayment(current, 'failed') ? 'failed' : null;
    case 'payment_intent.canceled':
      return canTransitionPayment(current, 'canceled') ? 'canceled' : null;
    default:
      return null;
  }
}

export function calculateRefundState(
  currentStatus: PaymentStatus,
  paymentAmountMinor: number,
  currentRefundedMinor: number,
  reportedRefundedMinor: number,
): { status: 'partially_refunded' | 'refunded'; refundedAmountMinor: number } {
  if (
    !Number.isSafeInteger(paymentAmountMinor) ||
    paymentAmountMinor <= 0 ||
    !Number.isSafeInteger(currentRefundedMinor) ||
    currentRefundedMinor < 0 ||
    !Number.isSafeInteger(reportedRefundedMinor) ||
    reportedRefundedMinor < 0
  ) {
    throw new Error(
      'Refund amounts must be non-negative safe integers and payment amount must be positive.',
    );
  }
  const refundedAmountMinor = Math.max(currentRefundedMinor, reportedRefundedMinor);
  if (refundedAmountMinor <= 0 || refundedAmountMinor > paymentAmountMinor) {
    throw new Error('Stripe refund total is outside the payment amount.');
  }
  if (!['succeeded', 'partially_refunded', 'refunded'].includes(currentStatus)) {
    throw new Error(`Payment in ${currentStatus} state cannot be marked refunded.`);
  }
  return {
    status:
      currentStatus === 'refunded' || refundedAmountMinor === paymentAmountMinor
        ? 'refunded'
        : 'partially_refunded',
    refundedAmountMinor,
  };
}

export function getStripeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey) throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is required.');
  if (!/^sk_(test|live)_/.test(secretKey)) {
    throw new Error('STRIPE_SECRET_KEY must be a Stripe test-mode or live-mode secret key.');
  }
  if (!webhookSecret) {
    throw new Error('Stripe webhooks are not configured: STRIPE_WEBHOOK_SECRET is required.');
  }
  if (!/^whsec_/.test(webhookSecret)) {
    throw new Error('STRIPE_WEBHOOK_SECRET has an invalid format.');
  }
  return {
    secretKey,
    webhookSecret,
    mode: secretKey.startsWith('sk_live_') ? 'live' : 'test',
  } as const;
}
