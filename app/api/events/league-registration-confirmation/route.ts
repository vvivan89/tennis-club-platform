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
        { error: 'A valid League registration is required.' },
        { status: 400 },
      );
    }

    const db = createServiceRoleClient();
    const { data: participant, error: participantError } = await db
      .from('tournament_participants')
      .select('id,event_id,user_id')
      .eq('id', body.participantId)
      .maybeSingle();
    if (participantError || !participant || participant.user_id !== user.id) {
      return NextResponse.json({ error: 'League registration not found.' }, { status: 404 });
    }

    const { data: pair, error: pairError } = await db
      .from('tournament_pairs')
      .select('id,player_one_id,player_two_id,league_team_id')
      .eq('event_id', participant.event_id)
      .eq('status', 'active')
      .or(`player_one_id.eq.${participant.id},player_two_id.eq.${participant.id}`)
      .maybeSingle();
    if (pairError || !pair?.league_team_id) {
      return NextResponse.json({ error: 'A confirmed League team is required.' }, { status: 409 });
    }

    const participantIds = [pair.player_one_id, pair.player_two_id];
    const { data: players, error: playersError } = await db
      .from('tournament_participants')
      .select('id,event_id,user_id,email,display_name,status,confirmation_status')
      .in('id', participantIds);
    if (
      playersError ||
      players?.length !== 2 ||
      players.some(
        (player) =>
          player.event_id !== participant.event_id ||
          !player.user_id ||
          player.status !== 'registered' ||
          player.confirmation_status !== 'confirmed' ||
          !player.email,
      )
    ) {
      return NextResponse.json(
        { error: 'Both League players must have confirmed registrations.' },
        { status: 409 },
      );
    }
    if (!players.some((player) => player.user_id === user.id)) {
      return NextResponse.json({ error: 'You are not part of this League team.' }, { status: 403 });
    }

    const { data: event, error: eventError } = await db
      .from('events')
      .select('id,title,slug,starts_at,location,status')
      .eq('id', participant.event_id)
      .maybeSingle();
    if (eventError || !event || event.status !== 'published') {
      return NextResponse.json({ error: 'The event could not be found.' }, { status: 404 });
    }

    const { data: profiles, error: profilesError } = await db
      .from('profiles')
      .select('id,email_registration_updates')
      .in(
        'id',
        players.map((player) => player.user_id),
      );
    if (profilesError) throw new Error('Could not load player email preferences.');
    const optedOut = new Set(
      (profiles ?? [])
        .filter((profile) => profile.email_registration_updates === false)
        .map((profile) => profile.id),
    );
    const recipients = players.filter((player) => !optedOut.has(player.user_id));
    if (!recipients.length) return NextResponse.json({ sent: 0, skipped: 2 });

    const eventTitle = event.title || 'League event';
    const eventUrl = `${getSiteOrigin(request)}/events/${encodeURIComponent(event.slug || event.id)}`;
    const eventDate = new Date(event.starts_at).toLocaleString('en-CA');
    const location = event.location ? ` · ${escapeHtml(event.location)}` : '';
    const subject = `Registration confirmed: ${eventTitle}`;
    const results = await Promise.all(
      recipients.map(async (recipient) => {
        const html = `<p>Hello ${escapeHtml(recipient.display_name || 'player')},</p><p>Your registration has been recorded. Your current registration status is shown below.</p><h2>${escapeHtml(eventTitle)}</h2><p><strong>Date:</strong> ${escapeHtml(eventDate)}${location}</p><p><strong>Registration status:</strong> Your registration is confirmed.</p><p><a href="${escapeHtml(eventUrl)}">View event details</a></p><p>Port Coquitlam Tennis Club</p>`;
        const result = await sendResendEmail({
          to: recipient.email,
          subject,
          html,
          idempotencyKey: `league-registration-confirmation:${event.id}:${pair.id}:${recipient.user_id}`,
        });
        if (!result.ok) {
          const detail = (await result.text()).slice(0, 500);
          throw new Error(
            `Could not send registration confirmation email (HTTP ${result.status}): ${detail}`,
          );
        }
      }),
    );
    return NextResponse.json({ sent: results.length, skipped: 2 - results.length });
  } catch (error) {
    console.error(
      '[League registration confirmation]',
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json(
      { error: 'The registration was saved, but confirmation emails could not be sent.' },
      { status: 502 },
    );
  }
}
