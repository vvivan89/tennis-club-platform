import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getSiteOrigin } from '@/lib/site-url';
import { isUuid } from '@/lib/api-helpers';
import { sendEventGuestSignInLink } from '@/lib/event-guest-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; eventId?: string; eventSlug?: string };
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !isUuid(body.eventId || '')
    ) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    const ipLimit = await enforceRateLimit(request, {
      name: 'event-guest-access',
      limit: 60,
      windowSeconds: 600,
    });
    if (ipLimit) return ipLimit;
    const emailLimit = await enforceRateLimit(request, {
      name: 'event-guest-access-email',
      limit: 20,
      windowSeconds: 600,
      userId: createHash('sha256').update(email).digest('hex'),
    });
    if (emailLimit) return emailLimit;

    const db = createServiceRoleClient();
    const [{ data: event }, { data: profile }] = await Promise.all([
      db
        .from('events')
        .select('id,slug,status,event_type,allow_non_member_registration')
        .eq('id', body.eventId)
        .maybeSingle(),
      db
        .from('profiles')
        .select('id,role,application_status,account_kind')
        .eq('email', email)
        .maybeSingle(),
    ]);
    if (
      !event ||
      event.status !== 'published' ||
      event.event_type !== 'tournament' ||
      !event.allow_non_member_registration
    ) {
      return NextResponse.json(
        { error: 'This event is not accepting event-only registrations.' },
        { status: 409 },
      );
    }

    if (profile && profile.account_kind !== 'event_guest') {
      if (profile.application_status === 'approved') {
        return NextResponse.json({
          memberLoginRequired: true,
          message: 'Please log in as a member.',
        });
      }
      return NextResponse.json({
        memberLoginRequired: true,
        message: 'Please log in with your existing PCTC account.',
      });
    }

    const siteOrigin = getSiteOrigin(request);
    const eventPath = `/events/${encodeURIComponent(event.slug || event.id)}`;
    const { error } = await sendEventGuestSignInLink(
      email,
      `${siteOrigin}/auth/guest-callback?next=${encodeURIComponent(eventPath)}`,
    );
    if (error) throw error;
    return NextResponse.json({
      sent: true,
      message: 'Check your email for a sign-in link to continue registration.',
    });
  } catch (error) {
    console.error('[Event guest access]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'Could not send the sign-in link. Please try again.' },
      { status: 500 },
    );
  }
}
