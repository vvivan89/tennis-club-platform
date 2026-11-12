import { NextResponse } from 'next/server';
import { escapeHtml, sendResendEmail } from '@/lib/resend';
import { getSiteOrigin } from '@/lib/site-url';
import {
  checkAdminRole,
  getConfiguredServiceClient,
  getSignedInUser,
  jsonError,
} from '@/lib/api-helpers';
export async function POST(request: Request) {
  try {
    const { auth: session, user, response: authError } = await getSignedInUser();
    if (authError) return authError;
    const adminError = await checkAdminRole(session, user.id);
    if (adminError) return adminError;
    const body = await request.json();
    const userId = String(body.userId || '');
    const action = String(body.action || '');
    if (!userId || !['approve', 'dismiss'].includes(action))
      return jsonError('Invalid application action.', 400);
    const { db: admin, response: configError } = getConfiguredServiceClient(
      'Server configuration is missing SUPABASE_SERVICE_ROLE_KEY.',
      500,
    );
    if (configError) return configError;
    const { data: app, error: readError } = await admin
      .from('profiles')
      .select('id,email,full_name,application_status,account_kind')
      .eq('id', userId)
      .maybeSingle();
    if (readError || !app)
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    if (app.account_kind !== 'member' || app.application_status !== 'pending')
      return NextResponse.json(
        { error: 'This application has already been processed.' },
        { status: 409 },
      );
    const { error } = await admin
      .from('profiles')
      .update({
        application_status: action === 'approve' ? 'approved' : 'dismissed',
        ...(action === 'approve' ? { role: 'member' } : {}),
      })
      .eq('id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let emailSent = false;
    let emailError: string | undefined;
    let resendMessageId: string | undefined;
    if (action === 'approve') {
      const resendKey = process.env.RESEND_API_KEY;
      const fromEmail =
        process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM;
      if (!resendKey)
        emailError = 'Email was not sent: RESEND_API_KEY is missing from the server environment.';
      else if (!fromEmail)
        emailError =
          'Email was not sent: set RESEND_FROM_EMAIL to a sender address on a domain verified in Resend. An API key alone is not enough.';
      else if (!app.email)
        emailError =
          'Email was not sent: the approved account has no email address in its profile.';
      else
        try {
          const { data: clubSettings } = await admin
            .from('club_settings')
            .select('short_name')
            .eq('id', 1)
            .maybeSingle();
          const shortName = clubSettings?.short_name || 'Tennis Club';
          const emailResponse = await sendResendEmail({
            apiKey: resendKey,
            from: fromEmail,
            to: app.email,
            subject: `Your ${shortName} application has been approved`,
            html: `<p>Hello ${escapeHtml(String(app.full_name || ''))},</p><p>Your ${escapeHtml(shortName)} account has been approved. You can now sign in and access member features.</p><p><a href="${new URL('/login', getSiteOrigin(request)).toString()}">Sign in to ${escapeHtml(shortName)}</a></p>`,
          });
          const raw = await emailResponse.text();
          let payload: Record<string, unknown> = {};
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            payload = { message: raw };
          }
          if (emailResponse.ok) {
            emailSent = true;
            resendMessageId = typeof payload.id === 'string' ? payload.id : undefined;
          } else
            emailError = `Resend rejected the email (HTTP ${emailResponse.status}): ${String(payload.message || payload.name || raw || 'No error details returned by Resend').slice(0, 1200)}`;
        } catch (e) {
          emailError = `Could not contact Resend: ${e instanceof Error ? e.message : 'Unknown network error'}`;
        }
    }
    return NextResponse.json({
      success: true,
      emailSent,
      ...(emailError ? { emailError } : {}),
      ...(resendMessageId ? { resendMessageId } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected server error.' },
      { status: 500 },
    );
  }
}
