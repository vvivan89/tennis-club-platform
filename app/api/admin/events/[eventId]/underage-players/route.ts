import { NextResponse } from 'next/server';
import { getConfiguredServiceClient, getSignedInUser, isUuid } from '@/lib/api-helpers';
import { isUnder18, playerAge } from '@/lib/player-guardian-details';

type PrivatePlayerDetails = {
  id: string;
  participant_id: string | null;
  profile_id: string | null;
  date_of_birth: string;
};

type GuardianRow = {
  private_details_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: 'Invalid event.' }, { status: 400 });

  const { auth, user, response: authError } = await getSignedInUser();
  if (authError || !user) return authError;

  const [{ data: profile }, { data: event }] = await Promise.all([
    auth.from('profiles').select('role,application_status').eq('id', user.id).maybeSingle(),
    auth.from('events').select('created_by,organizer_id').eq('id', eventId).maybeSingle(),
  ]);
  const isApprovedManager = profile?.application_status === 'approved';
  const isAdmin = isApprovedManager && profile.role === 'admin';
  const isOrganizer =
    isApprovedManager &&
    profile.role === 'organizer' &&
    (event?.organizer_id ?? event?.created_by) === user.id;
  if (!isAdmin && !isOrganizer)
    return NextResponse.json({ error: 'Event manager access required.' }, { status: 403 });

  const { db, response: configError } = getConfiguredServiceClient(
    'Server configuration is missing SUPABASE_SERVICE_ROLE_KEY.',
    500,
  );
  if (configError || !db) return configError;

  const { data: participants, error: participantError } = await db
    .from('tournament_participants')
    .select('id,user_id')
    .eq('event_id', eventId);
  if (participantError)
    return NextResponse.json({ error: 'Could not load tournament players.' }, { status: 500 });
  if (!participants?.length) return NextResponse.json({ players: {} });

  const participantIds = participants.map((participant) => participant.id);
  const profileIds = participants
    .map((participant) => participant.user_id)
    .filter((id): id is string => Boolean(id));
  const [participantDetails, profileDetails] = await Promise.all([
    db
      .from('player_private_details')
      .select('id,participant_id,profile_id,date_of_birth')
      .in('participant_id', participantIds),
    profileIds.length
      ? db
          .from('player_private_details')
          .select('id,participant_id,profile_id,date_of_birth')
          .in('profile_id', profileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (participantDetails.error || profileDetails.error)
    return NextResponse.json({ error: 'Could not load private player details.' }, { status: 500 });

  const details = [
    ...((participantDetails.data ?? []) as PrivatePlayerDetails[]),
    ...((profileDetails.data ?? []) as PrivatePlayerDetails[]),
  ];
  const detailIds = [...new Set(details.map((row) => row.id))];
  const { data: guardianRows, error: guardianError } = detailIds.length
    ? await db
        .from('player_legal_guardians')
        .select('private_details_id,full_name,email,phone')
        .in('private_details_id', detailIds)
        .order('created_at')
    : { data: [], error: null };
  if (guardianError)
    return NextResponse.json({ error: 'Could not load guardian contacts.' }, { status: 500 });

  const guardiansByDetails = new Map<string, GuardianRow[]>();
  for (const guardian of (guardianRows ?? []) as GuardianRow[]) {
    const rows = guardiansByDetails.get(guardian.private_details_id) ?? [];
    rows.push(guardian);
    guardiansByDetails.set(guardian.private_details_id, rows);
  }
  const detailsByParticipant = new Map(
    details.filter((row) => row.participant_id).map((row) => [row.participant_id!, row]),
  );
  const detailsByProfile = new Map(
    details.filter((row) => row.profile_id).map((row) => [row.profile_id!, row]),
  );
  const players: Record<
    string,
    { age: number; guardians: Array<{ name: string; email: string | null; phone: string | null }> }
  > = {};
  for (const participant of participants) {
    const detail =
      detailsByParticipant.get(participant.id) ??
      (participant.user_id ? detailsByProfile.get(participant.user_id) : undefined);
    if (!detail || !isUnder18(detail.date_of_birth)) continue;
    players[participant.id] = {
      age: playerAge(detail.date_of_birth) ?? 0,
      guardians: (guardiansByDetails.get(detail.id) ?? []).map((guardian) => ({
        name: guardian.full_name,
        email: guardian.email,
        phone: guardian.phone,
      })),
    };
  }
  return NextResponse.json({ players });
}
