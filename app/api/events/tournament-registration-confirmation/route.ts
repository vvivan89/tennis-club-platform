import { NextResponse } from 'next/server';
import { getSignedInUser, isUuid } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { escapeHtml, sendResendEmail } from '@/lib/resend';
import { getSiteOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { user, response } = await getSignedInUser();
    if (response || !user) return response;

    const body = (await request.json()) as { participantId?: string };
    if (!body.participantId || !isUuid(body.participantId)) {
      return NextResponse.json(
        { error: 'A valid tournament registration is required.' },
        { status: 400 },
      );
    }

    const db = createServiceRoleClient();
    const { data: participant, error: participantError } = await db
      .from('tournament_participants')
      .select('id,event_id,user_id,email,display_name,status,confirmation_status')
      .eq('id', body.participantId)
      .maybeSingle();
    if (participantError || !participant || participant.user_id !== user.id) {
      return NextResponse.json({ error: 'Tournament registration not found.' }, { status: 404 });
    }
    if (
      participant.status !== 'registered' ||
      participant.confirmation_status !== 'confirmed' ||
      !participant.email
    ) {
      return NextResponse.json(
        { error: 'This registration is not confirmed yet.' },
        { status: 409 },
      );
    }

    const { data: pair, error: pairError } = await db
      .from('tournament_pairs')
      .select('id')
      .eq('event_id', participant.event_id)
      .eq('status', 'active')
      .or(`player_one_id.eq.${participant.id},player_two_id.eq.${participant.id}`)
      .maybeSingle();
    if (pairError) throw new Error('Could not verify the tournament registration.');
    if (pair) {
      return NextResponse.json(
        { error: 'Partner registrations are confirmed after both players complete confirmation.' },
        { status: 409 },
      );
    }

    const [{ data: event, error: eventError }, { data: profile, error: profileError }] =
      await Promise.all([
        db
          .from('events')
          .select('id,title,slug,starts_at,location,status,event_type')
          .eq('id', participant.event_id)
          .maybeSingle(),
        db.from('profiles').select('email_registration_updates').eq('id', user.id).maybeSingle(),
      ]);
    if (eventError || !event || event.status !== 'published' || event.event_type !== 'tournament') {
      return NextResponse.json({ error: 'The tournament could not be found.' }, { status: 404 });
    }
    if (profileError) throw new Error('Could not load email preferences.');
    if (profile?.email_registration_updates === false) {
      return NextResponse.json({ sent: 0, skipped: 1 });
    }

    const eventTitle = event.title || 'Tournament';
    const eventUrl = `${getSiteOrigin(request)}/events/${encodeURIComponent(event.slug || event.id)}`;
    const eventDate = new Date(event.starts_at).toLocaleString('en-CA');
    const location = event.location ? ` · ${escapeHtml(event.location)}` : '';
    const result = await sendResendEmail({
      request,
      to: participant.email,
      subject: `Registration confirmed: ${eventTitle}`,
      html: `<p>Hello ${escapeHtml(participant.display_name || 'player')},</p><p>Your registration has been recorded. Your current registration status is shown below.</p><h2>${escapeHtml(eventTitle)}</h2><p><strong>Date:</strong> ${escapeHtml(eventDate)}${location}</p><p><strong>Registration status:</strong> Your registration is confirmed.</p><p><a href="${escapeHtml(eventUrl)}">View event details</a></p><p>Port Coquitlam Tennis Club</p>`,
      idempotencyKey: `tournament-registration-confirmation:${participant.id}`,
    });
    if (!result.ok) {
      const detail = (await result.text()).slice(0, 500);
      throw new Error(
        `Could not send registration confirmation email (HTTP ${result.status}): ${detail}`,
      );
    }
    return NextResponse.json({ sent: 1, skipped: 0 });
  } catch (error) {
    console.error(
      '[Tournament registration confirmation]',
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json(
      { error: 'The registration was saved, but its confirmation email could not be sent.' },
      { status: 502 },
    );
  }
}
