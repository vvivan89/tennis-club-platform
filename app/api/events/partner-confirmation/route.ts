import { NextResponse } from 'next/server';
import { getSignedInUser } from '@/lib/api-helpers';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isUuid } from '@/lib/api-helpers';

export const runtime = 'nodejs';

async function loadInvitation(request: Request) {
  const { user, response } = await getSignedInUser('Sign in to confirm this partner invitation.');
  if (response || !user) return { response };
  if (!user.email || !user.email_confirmed_at)
    return {
      response: NextResponse.json({ error: 'Verify the invited email first.' }, { status: 403 }),
    };
  const participantId = new URL(request.url).searchParams.get('participantId');
  if (!participantId || !isUuid(participantId))
    return {
      response: NextResponse.json({ error: 'A valid invitation is required.' }, { status: 400 }),
    };
  const db = createServiceRoleClient();
  const { data: participant, error } = await db
    .from('tournament_participants')
    .select(
      'id,event_id,user_id,category,display_name,email,phone,gender,tennis_skill_level,status,confirmation_status,event:events(id,slug,title)',
    )
    .eq('id', participantId)
    .maybeSingle();
  const event = Array.isArray(participant?.event) ? participant.event[0] : participant?.event;
  if (
    error ||
    !participant ||
    !event ||
    participant.confirmation_status !== 'pending' ||
    !participant.email ||
    participant.email.toLowerCase() !== user.email.toLowerCase() ||
    (participant.user_id && participant.user_id !== user.id)
  ) {
    return {
      response: NextResponse.json(
        { error: 'This invitation does not match your verified email or is no longer available.' },
        { status: 404 },
      ),
    };
  }
  const { data: pair } = await db
    .from('tournament_pairs')
    .select('player_one_id,player_two_id')
    .eq('event_id', participant.event_id)
    .eq('status', 'active')
    .or(`player_one_id.eq.${participant.id},player_two_id.eq.${participant.id}`)
    .maybeSingle();
  if (!pair)
    return {
      response: NextResponse.json(
        { error: 'This event invitation is no longer active.' },
        { status: 404 },
      ),
    };
  const otherId = pair.player_one_id === participant.id ? pair.player_two_id : pair.player_one_id;
  const { data: inviter } = await db
    .from('tournament_participants')
    .select('display_name')
    .eq('id', otherId)
    .maybeSingle();
  return { user, participant, event, inviterName: inviter?.display_name || 'Your partner' };
}

export async function GET(request: Request) {
  try {
    const result = await loadInvitation(request);
    if ('response' in result) return result.response!;
    return NextResponse.json(
      {
        participant: {
          id: result.participant.id,
          displayName: result.participant.display_name,
          email: result.participant.email,
          phone: result.participant.phone,
          gender: result.participant.gender,
          tennisSkillLevel: result.participant.tennis_skill_level,
        },
        event: result.event,
        invitedBy: result.inviterName,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error(
      '[Partner confirmation details]',
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json({ error: 'Could not load this invitation.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { participantId?: string };
    if (!body.participantId || !isUuid(body.participantId))
      return NextResponse.json({ error: 'A valid invitation is required.' }, { status: 400 });
    const result = await loadInvitation(
      new Request(
        `${new URL(request.url).origin}/api/events/partner-confirmation?participantId=${encodeURIComponent(body.participantId)}`,
        { headers: request.headers },
      ),
    );
    if ('response' in result) return result.response!;
    const auth = await createSupabaseServerClient();
    const { error } = await auth.rpc('confirm_tournament_partner', {
      p_participant_id: body.participantId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Partner confirmation]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Could not confirm this invitation.' }, { status: 500 });
  }
}
