import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    const { data: me } = await session
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (me?.role !== 'admin')
      return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
    const body = await request.json();
    const userId = String(body.userId || '');
    const action = String(body.action || '');
    if (!userId || !['approve', 'dismiss'].includes(action))
      return NextResponse.json({ error: 'Invalid application action.' }, { status: 400 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      return NextResponse.json(
        { error: 'Server configuration is missing SUPABASE_SERVICE_ROLE_KEY.' },
        { status: 500 },
      );
    const admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: app, error: readError } = await admin
      .from('profiles')
      .select('id,email,full_name,application_status')
      .eq('id', userId)
      .maybeSingle();
    if (readError || !app)
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    if (app.application_status !== 'pending')
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
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: fromEmail,
              to: [app.email],
              subject: 'Your PCTC application has been approved',
              html: `<p>Hello ${String(app.full_name || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)},</p><p>Your Port Coquitlam Tennis Club account has been approved. You can now sign in and access member features.</p><p><a href="${new URL('/login', request.url).toString()}">Sign in to PCTC</a></p>`,
            }),
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
