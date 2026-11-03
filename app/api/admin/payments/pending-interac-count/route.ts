import { NextResponse } from 'next/server';
import { getApprovedAdminContext } from '@/lib/admin-api-auth';
import { createPaymentServiceClient } from '@/lib/payments/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { response } = await getApprovedAdminContext();
  if (response) return response;

  const db = createPaymentServiceClient();
  const { count, error } = await db
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'interac')
    .eq('status', 'pending')
    .eq('manual_review_status', 'submitted');

  if (error) {
    console.error('[Admin payments] Could not count unreviewed Interac payments', error.message);
    return NextResponse.json(
      { error: 'Could not load pending Interac payment count.' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { count: count ?? 0 },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
