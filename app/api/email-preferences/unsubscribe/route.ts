import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { enforceRateLimit } from '@/lib/rate-limit';
import { emailPreferenceTypes, type EmailPreferenceType } from '@/lib/email-unsubscribe';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, {
    name: 'email-unsubscribe',
    limit: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || !tokenPattern.test(body.token)) {
      return NextResponse.json(
        { error: 'This unsubscribe link is invalid or has expired.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const db = createServiceRoleClient();
    const { data, error } = await db.rpc('apply_email_unsubscribe', {
      p_token_hash: tokenHash,
    });
    if (error) {
      console.error('[Email unsubscribe] Could not apply preference update', error.message);
      return NextResponse.json(
        { error: 'We could not update this preference. Please try again.' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    const emailType = result?.email_type as EmailPreferenceType | null | undefined;
    if (!emailType || !(emailType in emailPreferenceTypes)) {
      return NextResponse.json(
        { error: 'This unsubscribe link is invalid or has expired.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (result?.outcome === 'already_used') {
      return NextResponse.json(
        {
          alreadyUsed: true,
          emailType,
          label: emailPreferenceTypes[emailType].label,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (result?.outcome !== 'unsubscribed') {
      return NextResponse.json(
        { error: 'This unsubscribe link is invalid or has expired.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        success: true,
        emailType,
        label: emailPreferenceTypes[emailType].label,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'This unsubscribe link is invalid or has expired.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
