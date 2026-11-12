import { NextResponse } from 'next/server';
import { getSignedInUser } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { getSiteOrigin } from '@/lib/site-url';
import { escapeHtml, sendResendEmail } from '@/lib/resend';
import { sendEventGuestSignInLink } from '@/lib/event-guest-auth';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { user, response } = await getSignedInUser();
    if (response || !user) return response;
    if (!user.email || !user.email_confirmed_at)
      return NextResponse.json(
        { invitations: [] },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );

    const db = createServiceRoleClient();
    const { data: entries, error } = await db
      .from('tournament_participants')
      .select(
        'id,event_id,display_name,updated_at,event:events!inner(id,slug,title,starts_at,status)',
      )
      .eq('email', user.email.toLowerCase())
      .eq('confirmation_status', 'pending')
      .in('status', ['registered', 'provisional']);
    if (error) throw new Error('Could not load pending tournament invitations.');

    const eventIds = [...new Set((entries ?? []).map((entry) => entry.event_id))];
    const { data: pairs, error: pairError } = eventIds.length
      ? await db
          .from('tournament_pairs')
          .select('event_id,player_one_id,player_two_id')
          .in('event_id', eventIds)
          .eq('status', 'active')
      : { data: [], error: null };
    if (pairError) throw new Error('Could not verify pending tournament invitations.');

    const now = Date.now();
    const invitations = (entries ?? []).flatMap((entry) => {
      const event = Array.isArray(entry.event) ? entry.event[0] : entry.event;
      const isPaired = pairs?.some(
        (pair) =>
          pair.event_id === entry.event_id &&
          (pair.player_one_id === entry.id || pair.player_two_id === entry.id),
      );
      if (
        !isPaired ||
        !event ||
        event.status !== 'published' ||
        new Date(event.starts_at).getTime() < now
      )
        return [];
      return [
        {
          participantId: entry.id,
          participantName: entry.display_name,
          eventId: event.id,
          eventSlug: event.slug,
          eventTitle: event.title,
          startsAt: event.starts_at,
        },
      ];
    });
    return NextResponse.json(
      { invitations },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error(
      '[Pending partner invitations]',
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json({ error: 'Could not load pending invitations.' }, { status: 500 });
  }
}

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
    const pairedParticipantIds = participants
      .map((target) =>
        pairs?.find((pair) => pair.player_one_id === target.id || pair.player_two_id === target.id),
      )
      .flatMap((pair) => (pair ? [pair.player_one_id, pair.player_two_id] : []));
    const counterpartIds = [...new Set(pairedParticipantIds)].filter(
      (id) => !participants.some((entry) => entry.id === id),
    );
    const { data: counterpartEntries, error: counterpartError } =
      !manager && counterpartIds.length
        ? await db
            .from('tournament_participants')
            .select('id,user_id,event_id')
            .in('id', counterpartIds)
        : { data: [], error: null };
    if (counterpartError) throw new Error('Could not verify the inviting partner.');
    const counterpartById = new Map((counterpartEntries ?? []).map((entry) => [entry.id, entry]));
    const allowed =
      manager ||
      participants.every((target) => {
        const pair = pairs?.find(
          (candidate) =>
            candidate.player_one_id === target.id || candidate.player_two_id === target.id,
        );
        const otherId = pair
          ? pair.player_one_id === target.id
            ? pair.player_two_id
            : pair.player_one_id
          : null;
        const otherEntry =
          participants.find((entry) => entry.id === otherId) ??
          (otherId ? counterpartById.get(otherId) : null);
        return otherEntry?.user_id === user.id && otherEntry.event_id === eventId;
      });
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
          request,
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
