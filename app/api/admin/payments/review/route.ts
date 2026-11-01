import { NextResponse } from 'next/server';
import { getApprovedAdminContext } from '@/lib/admin-api-auth';
import { sendResendEmail } from '@/lib/resend';
import { createPaymentServiceClient } from '@/lib/payments/server';
export async function POST(request: Request) {
  const { auth, response } = await getApprovedAdminContext();
  if (response) return response;
  try {
    const body = await request.json();
    if (typeof body.paymentId !== 'string' || !['confirm', 'reject'].includes(body.action))
      return NextResponse.json({ error: 'Invalid review request.' }, { status: 400 });
    const service = createPaymentServiceClient();
    const { data: before } = await service
      .from('payments')
      .select(
        'id,user_id,amount_minor,currency,purpose,status,manual_review_status,manual_outcome_sent_at',
      )
      .eq('id', body.paymentId)
      .maybeSingle();
    const { data, error } = await auth.rpc('review_manual_payment', {
      p_payment_id: body.paymentId,
      p_action: body.action,
      p_note: typeof body.note === 'string' ? body.note : null,
    });
    if (error)
      return NextResponse.json(
        { error: error.message || 'Could not review payment.' },
        { status: 400 },
      );
    const outcome = data as {
      userId?: string;
      amountMinor?: number;
      currency?: string;
      purpose?: string;
      status?: string;
      manualReviewStatus?: string;
      duplicate?: boolean;
    } | null;
    if (
      before?.user_id &&
      outcome &&
      !outcome.duplicate &&
      ['confirm', 'reject'].includes(body.action) &&
      !before.manual_outcome_sent_at &&
      process.env.RESEND_API_KEY &&
      (process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM)
    ) {
      try {
        const { data: member } = await service
          .from('profiles')
          .select('email,full_name')
          .eq('id', before.user_id)
          .maybeSingle();
        if (member?.email) {
          const approved = body.action === 'confirm';
          const from =
            process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM!;
          const response = await sendResendEmail({
            from,
            to: member.email,
            subject: approved
              ? 'PCTC Interac payment confirmed'
              : 'PCTC Interac payment requires attention',
            text: approved
              ? `Hello ${member.full_name || 'member'},\n\nThe club has confirmed your Interac payment of ${((outcome.amountMinor || 0) / 100).toFixed(2)} ${(outcome.currency || 'CAD').toUpperCase()}. Your associated membership or event registration has been updated.\n\nPayment reference: ${body.paymentId}`
              : `Hello ${member.full_name || 'member'},\n\nThe club could not confirm your Interac payment request. Reason: ${typeof body.note === 'string' ? body.note : 'Please contact the club.'}\n\nPayment reference: ${body.paymentId}`,
          });
          if (response.ok)
            await service
              .from('payments')
              .update({ manual_outcome_sent_at: new Date().toISOString() })
              .eq('id', body.paymentId)
              .is('manual_outcome_sent_at', null);
          else
            console.error('[Admin payments] Outcome email failed', {
              paymentId: body.paymentId,
              status: response.status,
            });
        }
      } catch (emailError) {
        console.error('[Admin payments] Outcome email failed', {
          paymentId: body.paymentId,
          message: emailError instanceof Error ? emailError.message : 'unknown',
        });
      }
    }
    return NextResponse.json({ ok: true, result: data });
  } catch {
    return NextResponse.json({ error: 'Could not review payment.' }, { status: 500 });
  }
}
