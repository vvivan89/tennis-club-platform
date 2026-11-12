import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSiteOrigin } from '@/lib/site-url';

export const emailPreferenceTypes = {
  registration_updates: {
    label: 'registration and withdrawal confirmations',
  },
  waitlist_updates: {
    label: 'waitlist promotion confirmations',
  },
  event_cancellations: {
    label: 'event cancellation notifications',
  },
  registration_reminders: {
    label: 'event registration and payment reminders',
  },
  membership_reminders: {
    label: 'membership renewal and payment reminders',
  },
  new_events: {
    label: 'new event announcements',
  },
  newsletter: {
    label: 'newsletter and club news',
  },
} as const;

export type EmailPreferenceType = keyof typeof emailPreferenceTypes;

export async function createEmailUnsubscribeUrl(
  db: Pick<SupabaseClient, 'from'>,
  request: Request,
  userId: string,
  emailType: EmailPreferenceType,
) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db.from('email_unsubscribe_tokens').insert({
    token_hash: tokenHash,
    user_id: userId,
    email_type: emailType,
    expires_at: expiresAt,
  });
  if (error) throw new Error('Could not prepare the email unsubscribe link.');

  const origin = getSiteOrigin(request);
  const url = new URL('/email-preferences/unsubscribe', origin);
  url.searchParams.set('token', token);
  return url.toString();
}
