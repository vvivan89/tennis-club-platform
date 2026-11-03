import { createServiceRoleClient } from '@/lib/supabase-service';

export type CheckoutBody = {
  purpose?: 'membership' | 'event_registration' | 'tournament_registration';
  provider?: 'stripe' | 'interac';
  businessRecordId?: string;
  membershipKind?: 'individual' | 'family';
  waiverAccepted?: boolean;
  waiverVersion?: number;
  idempotencyKey?: string;
  returnTo?: string;
  returnLabel?: string;
};

export function getCheckoutServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Payment storage is not configured on the server.');
  return createServiceRoleClient(url, key);
}
