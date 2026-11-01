import type { SupabaseClient } from '@supabase/supabase-js';

export const EMAIL_GROUPS = [
  'all',
  'newsletter',
  'active_members',
  'admins',
  'organizers',
] as const;
export type EmailGroup = (typeof EMAIL_GROUPS)[number];

export const MAX_EMAIL_RECIPIENTS = 500;
export const MAX_EMAIL_HTML_LENGTH = 100_000;

export const isEmailGroup = (value: string): value is EmailGroup =>
  (EMAIL_GROUPS as readonly string[]).includes(value);

export type EmailRecipient = { id: string; email: string | null; full_name: string | null };

const PAGE_SIZE = 1000;
const LOOKUP_BATCH = 50;

/** Approved members in the group; unapproved profiles are never included, whatever the group. */
export async function loadEmailRecipients(
  db: Pick<SupabaseClient, 'from'>,
  group: EmailGroup,
): Promise<EmailRecipient[]> {
  if (group === 'active_members') {
    const { data, error } = await db
      .from('memberships')
      .select('user_id')
      .eq('status', 'active')
      .or(`ends_on.is.null,ends_on.gte.${new Date().toISOString().slice(0, 10)}`);
    if (error) throw new Error('Could not load recipients.');
    const ids = [...new Set((data ?? []).map((x) => x.user_id as string))];
    const recipients: EmailRecipient[] = [];
    for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
      const { data: profiles, error: profileError } = await db
        .from('profiles')
        .select('id,email,full_name')
        .eq('application_status', 'approved')
        .in('id', ids.slice(i, i + LOOKUP_BATCH));
      if (profileError) throw new Error('Could not load recipients.');
      recipients.push(...((profiles ?? []) as EmailRecipient[]));
    }
    return recipients;
  }
  const recipients: EmailRecipient[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db
      .from('profiles')
      .select('id,email,full_name')
      .eq('application_status', 'approved');
    if (group === 'newsletter') query = query.eq('email_newsletter', true);
    if (group === 'admins') query = query.eq('role', 'admin');
    if (group === 'organizers') query = query.eq('role', 'organizer');
    const { data, error } = await query.order('id').range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error('Could not load recipients.');
    recipients.push(...((data ?? []) as EmailRecipient[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return recipients;
}
