import { NextResponse } from 'next/server';
import { getSignedInUser } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { getSiteOrigin } from '@/lib/site-url';
import { escapeHtml, sendResendEmail } from '@/lib/resend';
import { sendEventGuestSignInLink } from '@/lib/event-guest-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { user, response } = await getSignedInUser();
    if (response || !user) return response;
    const body = (await request.json()) as { participantIds?: string[] };
    const ids = [
      ...new Set((body.participantIds || []).filter((id) => /^[0-9a-f-]{36}$/i.test(id))),
    ];
    if (!ids.length || ids.length > 2)
      return NextResponse.json({ error: 'Select a valid partner invitation.' }, { status: 400 });

    const db = createServiceRoleClient();
    const [{ data: participants, error: participantError }, { data: callerProfile }] =
      await Promise.all([
        db
          .from('tournament_participants')
          .select('id,event_id,user_id,display_name,email,status,confirmation_status,updated_at')
          .in('id', ids),
        db.from('profiles').select('role,application_status').eq('id', user.id).maybeSingle(),
      ]);
    if (participantError || participants?.length !== ids.length)
      return NextResponse.json(
        { error: 'The invitation entries could not be found.' },
        { status: 404 },
      );
    const eventId = participants[0].event_id;
    if (
      participants.some(
        (entry) =>
          entry.event_id !== eventId || entry.confirmation_status !== 'pending' || !entry.email,
      )
    ) {
      return NextResponse.json(
        { error: 'These entries are not awaiting partner confirmation.' },
        { status: 409 },
      );
    }
    const { data: event } = await db
      .from('events')
      .select('slug,title,created_by,organizer_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!event)
      return NextResponse.json({ error: 'The event could not be found.' }, { status: 404 });
    const manager =
      callerProfile?.application_status === 'approved' &&
      (callerProfile.role === 'admin' ||
        (callerProfile.role === 'organizer' &&
          (event.created_by === user.id || event.organizer_id === user.id)));
    const { data: pairs, error: pairError } = await db
      .from('tournament_pairs')
      .select('player_one_id,player_two_id')
      .eq('event_id', eventId)
      .eq('status', 'active');
    if (pairError) throw new Error('Could not verify the event pair.');
    const allowed =
      manager ||
      participants.every((target) =>
        pairs?.some((pair) => {
          const otherId =
            pair.player_one_id === target.id
              ? pair.player_two_id
              : pair.player_two_id === target.id
                ? pair.player_one_id
                : null;
          return (
            !!otherId &&
            participants.some((entry) => entry.id === otherId && entry.user_id === user.id)
          );
        }),
      );
    if (!allowed)
      return NextResponse.json(
        { error: 'You cannot send this partner invitation.' },
        { status: 403 },
      );

    const inviterIdByInvitee = new Map<string, string>();
    for (const participant of participants) {
      const pair = pairs?.find(
        (candidate) =>
          candidate.player_one_id === participant.id || candidate.player_two_id === participant.id,
      );
      const inviterId = pair
        ? pair.player_one_id === participant.id
          ? pair.player_two_id
          : pair.player_two_id === participant.id
            ? pair.player_one_id
            : null
        : null;
      if (inviterId) inviterIdByInvitee.set(participant.id, inviterId);
    }
    const inviterIds = [...new Set(inviterIdByInvitee.values())];
    const { data: inviters, error: inviterError } = inviterIds.length
      ? await db.from('tournament_participants').select('id,display_name').in('id', inviterIds)
      : { data: [], error: null };
    if (inviterError) throw new Error('Could not load the inviting partner name.');
    const inviterById = new Map((inviters ?? []).map((inviter) => [inviter.id, inviter]));

    const origin = getSiteOrigin(request);
    const slug = event.slug || eventId;
    const responses = [];
    for (const participant of participants) {
      const email = participant.email.trim().toLowerCase();
      const { data: account } = await db
        .from('profiles')
        .select('id,role,application_status,account_kind')
        .eq('email', email)
        .maybeSingle();
      const next = `/events/${encodeURIComponent(slug)}?confirm_partner=${encodeURIComponent(participant.id)}`;
      if (account && account.account_kind !== 'event_guest') {
        const loginUrl = `${origin}/login?next=${encodeURIComponent(next)}`;
        const inviterName =
          inviterById.get(inviterIdByInvitee.get(participant.id) || '')?.display_name ||
          'A tournament participant';
        const sent = await sendResendEmail({
          to: email,
          subject: `Confirm your place with ${inviterName}`,
          html: `<p>Hello ${escapeHtml(participant.display_name)},</p><p>${escapeHtml(inviterName)} has listed you as a partner for <strong>${escapeHtml(event.title || 'this event')}</strong>. Sign in to review the entry details and confirm your participation.</p><p><a href="${escapeHtml(loginUrl)}">Review and confirm your event entry</a></p><p>If you do not recognize this invitation, you can ignore this email.</p><p>Port Coquitlam Tennis Club</p>`,
          idempotencyKey: `partner-confirm:${participant.id}:${participant.updated_at}`,
        });
        if (!sent.ok) throw new Error('Could not email the member partner invitation.');
        responses.push({ participantId: participant.id, sent: true });
      } else {
        const { error } = await sendEventGuestSignInLink(
          email,
          `${origin}/auth/guest-callback?next=${encodeURIComponent(next)}`,
        );
        if (error) throw error;
        responses.push({ participantId: participant.id, sent: true });
      }
    }
    return NextResponse.json({ invitations: responses });
  } catch (error) {
    console.error('[Partner invitations]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'Could not send the partner confirmation request. Please retry.' },
      { status: 500 },
    );
  }
}
