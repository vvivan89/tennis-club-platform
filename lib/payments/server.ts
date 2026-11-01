import 'server-only';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { validatePaymentInput, type PaymentPurpose } from './core';

export function createPaymentServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Payment storage is not configured on the server.');
  return createServiceRoleClient(url, key);
}

export async function createPendingPayment(input: {
  userId: string | null;
  purpose: PaymentPurpose;
  businessRecordId?: string | null;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}) {
  const validated = validatePaymentInput(input);
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new Error('A valid payment idempotency key is required.');
  }
  const supabase = createPaymentServiceClient();
  const { data, error } = await supabase
    .from('payments')
    .upsert(
      {
        user_id: input.userId,
        purpose: validated.purpose,
        business_record_id: input.businessRecordId ?? null,
        amount_minor: validated.amountMinor,
        currency: validated.currency,
        status: 'pending',
        idempotency_key: input.idempotencyKey,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    .select('id,user_id,purpose,business_record_id,amount_minor,currency,status')
    .maybeSingle();
  if (error) throw new Error('Could not create payment record.');
  let payment = data;
  if (!payment) {
    const existing = await supabase
      .from('payments')
      .select('id,user_id,purpose,business_record_id,amount_minor,currency,status')
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();
    if (existing.error || !existing.data)
      throw new Error('Could not retrieve idempotent payment record.');
    payment = existing.data;
  }
  const row = payment;
  if (
    row.amount_minor !== validated.amountMinor ||
    row.currency !== validated.currency ||
    row.purpose !== validated.purpose ||
    row.user_id !== input.userId ||
    row.business_record_id !== (input.businessRecordId ?? null)
  ) {
    throw new Error('Idempotency key was already used for a different payment request.');
  }
  const { error: auditError } = await supabase.from('audit_logs').upsert(
    {
      actor_user_id: input.userId,
      actor_label: input.userId ? 'user' : 'system',
      action: 'payment.created',
      outcome: 'success',
      target_table: 'payments',
      target_record_id: row.id,
      source: 'payment_service',
      summary: `Payment record created for ${row.purpose}.`,
      changes: { amountMinor: row.amount_minor, currency: row.currency, purpose: row.purpose },
      idempotency_key: `payment:create:${input.idempotencyKey}`,
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true },
  );
  if (auditError)
    throw new Error('Payment was saved, but its audit record could not be written. Retry safely.');
  return row;
}
