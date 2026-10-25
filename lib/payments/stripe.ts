import 'server-only';
import Stripe from 'stripe';
import { getStripeConfiguration } from './core';

let cached: Stripe | undefined;

export function getStripeClient(): Stripe {
  if (cached) return cached;
  const config = getStripeConfiguration();
  cached = new Stripe(config.secretKey);
  return cached;
}

export function getStripeWebhookSecret(): string {
  return getStripeConfiguration().webhookSecret;
}
