import { notFound, redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SiteHeader } from '@/components/site-header';
import { ClubSiteFooter } from '@/components/club-site-footer';
import { findEventBySlugAlias } from '@/lib/event-alias';
import { EventDetailClient } from '@/components/event-detail-client';
import { EventEditManagement } from '@/components/event-edit-management';
import { eventEditPath, eventPath } from '@/lib/event-slug';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { TournamentManagement } from '@/components/tournament-management';
import { TournamentPublicView } from '@/components/tournament-public-view';
import { PublicOrganizerContacts } from '@/components/public-organizer-contacts';
import { eventDisplayTitle, withEventSeriesNumbers } from '@/lib/event-format';

export default async function EventDetailsPage({
  params: paramsPromise,
}: {
  params: Promise<{ slug: string }>;
}) {
  const params = await paramsPromise;
  const db = await createSupabaseServerClient();
  const [
    {
      data: { user },
    },
    { data: initialEvent },
    { data: club },
  ] = await Promise.all([
    db.auth.getUser(),
    db.from('events').select('*').eq('slug', params.slug).maybeSingle(),
    db
      .from('club_settings')
      .select('club_name,short_name,social_links,location_query')
      .eq('id', 1)
      .maybeSingle(),
  ]);
  let resolvedEvent = initialEvent;
  if (
    !resolvedEvent &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.slug)
  ) {
    const { data: legacyEvent } = await db
      .from('events')
      .select('*')
      .eq('id', params.slug)
      .maybeSingle();
    if (legacyEvent) resolvedEvent = legacyEvent;
  }
  if (!resolvedEvent) resolvedEvent = await findEventBySlugAlias(db, params.slug);
  const event = resolvedEvent;
  if (!event) notFound();
  const { data: viewerProfile } =
    event.event_type === 'party' && user
      ? await db.from('profiles').select('application_status').eq('id', user.id).maybeSingle()
      : { data: null };
  if (event.event_type === 'party' && viewerProfile?.application_status !== 'approved') notFound();
  const { data: seriesSessions } = event.series_id
    ? await db.from('events').select('id,series_id,starts_at').eq('series_id', event.series_id)
    : { data: [] };
  const numberedEvent = withEventSeriesNumbers([event], seriesSessions ?? [])[0];
  const eventTitle = eventDisplayTitle(numberedEvent);
  const displayEvent = { ...event, title: eventTitle };
  const [{ data: league }, { data: leagueSnapshot }, { data: leagueEventMatches }] =
    event.social_doubles_ladder_id
      ? await Promise.all([
          db
            .from('social_doubles_ladders')
            .select('id,name,competition_type,gender')
            .eq('id', event.social_doubles_ladder_id)
            .maybeSingle(),
          db
            .from('league_standings_snapshots')
            .select('standings,standings_after')
            .eq('event_id', event.id)
            .maybeSingle(),
          db.from('tournament_public_matches').select('status').eq('event_id', event.id),
        ])
      : [{ data: null }, { data: null }, { data: null }];
  const isLeagueTournament = league?.competition_type === 'league';
  if (event.slug && params.slug !== event.slug)
    redirect(eventPath({ id: event.id, slug: event.slug }));
  if (!['published', 'cancelled'].includes(event.status)) {
    const { data: profile } = user
      ? await db
          .from('profiles')
          .select(
            'role,application_status,account_kind,email,full_name,phone,tennis_skill_level,gender',
          )
          .eq('id', user.id)
          .maybeSingle()
      : { data: null };
    const allowedManager =
      profile?.role === 'admin' ||
      (profile?.role === 'organizer' && (event?.organizer_id ?? event?.created_by) === user?.id);
    if (!event || !allowedManager) notFound();
  }
  const [
    { data: registration },
    { data: profile },
    { data: publicCount },
    { data: publicOrganizerContacts },
    { data: memberOrganizerContacts },
  ] = await Promise.all([
    user
      ? db
          .from('registrations')
          .select('id,status,queue_position,created_at,payment_status,guest_count')
          .eq('event_id', event.id)
          .eq('user_id', user.id)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? db
          .from('profiles')
          .select(
            'role,application_status,account_kind,email,full_name,phone,tennis_skill_level,gender',
          )
          .eq('id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('event_public_counts').select('confirmed_count').eq('event_id', event.id).maybeSingle(),
    db.rpc('event_public_organizer_contacts', { p_event_id: event.id }),
    user
      ? db.rpc('event_organizer_contacts', { p_event_id: event.id })
      : Promise.resolve({ data: [] }),
  ]);
  const organizerContacts = memberOrganizerContacts?.length
    ? memberOrganizerContacts
    : publicOrganizerContacts;
  const isManager =
    profile?.application_status === 'approved' &&
    (profile?.role === 'admin' ||
      (profile?.role === 'organizer' && (event.organizer_id ?? event.created_by) === user?.id));
  const { data: captainTeam } =
    user && event.tournament_format === 'team' && !isManager
      ? await db
          .from('tournament_public_teams')
          .select('id')
          .eq('event_id', event.id)
          .eq('captain_user_id', user.id)
          .maybeSingle()
      : { data: null };
  const isTeamCaptain = !!captainTeam;
  let hasPaidMembership = false;
  if (user) {
    const { data: paidMembership, error: paidMembershipError } = await db.rpc(
      'has_active_paid_membership',
      { v_user: user.id },
    );
    if (!paidMembershipError) hasPaidMembership = paidMembership === true;
  }
  const { data: paymentMethodSettings } = await db
    .from('payment_method_settings')
    .select('interac_enabled')
    .eq('id', 1)
    .maybeSingle();
  const interacEnabled = paymentMethodSettings?.interac_enabled === true;
  const registered = !!registration && registration.status !== 'cancelled';
  const canViewParticipants =
    isManager ||
    (registered &&
      (event.event_type === 'party'
        ? viewerProfile?.application_status === 'approved'
        : hasPaidMembership));
  const [{ data: roster }, { data: courts }, { data: scores }] = await Promise.all([
    canViewParticipants
      ? db
          .from('event_roster')
          .select(
            'registration_id,user_id,status,payment_status,guest_count,queue_position,full_name,avatar_url,tennis_skill_level,birthday_emoji_visible',
          )
          .eq('event_id', event.id)
      : Promise.resolve({ data: [] }),
    canViewParticipants
      ? db
          .from('event_court_assignments')
          .select('registration_id,court_number,segment_order')
          .eq('event_id', event.id)
      : Promise.resolve({ data: [] }),
    canViewParticipants
      ? db
          .from('event_scoreboard')
          .select(
            'id,event_id,player_one_registration_id,player_two_registration_id,player_one_score,player_two_score,played_at,player_one_name,player_two_name,player_three_registration_id,player_four_registration_id,player_three_name,player_four_name,entered_by',
          )
          .eq('event_id', event.id)
          .order('played_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  let rosterRows = roster ?? [];
  if (isManager && rosterRows.length) {
    const { data: directory } = await db.rpc('event_member_directory', { p_event_id: event.id });
    const directoryRows = (directory ?? []) as Array<Record<string, unknown> & { id: string }>;
    const contactById = new Map<string, Record<string, unknown>>(
      directoryRows.map((p) => [p.id, p] as const),
    );
    rosterRows = rosterRows.map((r) => ({ ...r, ...(contactById.get(r.user_id) ?? {}) }));
  }
  const leagueStandingsBefore = Array.isArray(leagueSnapshot?.standings)
    ? (leagueSnapshot.standings as Array<Record<string, unknown>>)
    : [];
  const leagueStandingsAfter = Array.isArray(leagueSnapshot?.standings_after)
    ? (leagueSnapshot.standings_after as Array<Record<string, unknown>>)
    : [];
  const publicOrganizerRows = (publicOrganizerContacts ?? []) as Array<{
    organizer_name?: string | null;
  }>;
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        clubName={club?.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club?.short_name || 'PCTC'}
      />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Club event</p>
        <div className="flex items-center gap-3">
          <h1 className="section-title min-w-0">{eventTitle}</h1>
          {isManager && (
            <Button asChild variant="outline" size="icon">
              <Link href={eventEditPath(event)} aria-label="Edit event" title="Edit event">
                <Pencil aria-hidden="true" className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
        {event.event_type === 'tournament' && !user ? (
          <PublicOrganizerContacts
            eventId={event.id}
            organizerNames={[
              ...new Set(
                publicOrganizerRows
                  .map((contact) => contact.organizer_name)
                  .filter((name): name is string => Boolean(name)),
              ),
            ]}
          />
        ) : (
          !!organizerContacts?.length && (
            <section
              className="my-6 border-y border-border py-5"
              aria-labelledby="event-organizer-title"
            >
              <h2 id="event-organizer-title" className="text-lg font-semibold">
                Event organizer
              </h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {organizerContacts.map(
                  (contact: {
                    organizer_id: string;
                    organizer_name: string;
                    position: string;
                    emails: string[];
                    phones: string[];
                  }) => (
                    <div
                      key={`${contact.organizer_id}-${contact.position}`}
                      className="flex flex-wrap items-start gap-x-5 gap-y-2"
                    >
                      <div className="min-w-36">
                        <p className="font-medium">{contact.organizer_name}</p>
                        <p className="text-sm text-muted-foreground">{contact.position}</p>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-5 gap-y-1">
                        {!!contact.emails?.length && (
                          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            {contact.emails.map((email) => (
                              <li key={email}>
                                <a className="text-primary underline" href={`mailto:${email}`}>
                                  {email}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!!contact.phones?.length && (
                          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            {contact.phones.map((phone) => (
                              <li key={phone}>
                                <a className="text-primary underline" href={`tel:${phone}`}>
                                  {phone}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </section>
          )
        )}
        {event.event_type === 'tournament' ? (
          <>
            <TournamentPublicView
              adminContent={
                isManager || isTeamCaptain ? (
                  <TournamentManagement
                    eventId={event.id}
                    leagueId={event.social_doubles_ladder_id ?? null}
                    eventStartsAt={event.starts_at}
                    eventEndsAt={event.ends_at}
                    courtCount={event.court_count ?? 4}
                    format={event.tournament_format}
                    config={event.tournament_config ?? {}}
                    priceCents={event.price_cents ?? 0}
                    leagueTournament={isLeagueTournament}
                    leagueGender={league?.gender ?? null}
                    captainMode={!isManager && isTeamCaptain}
                    captainTeamId={captainTeam?.id ?? null}
                  />
                ) : null
              }
              eventTitle={eventTitle}
              isManager={isManager}
              eventSlug={event.slug || params.slug}
              eventDescription={event.description ?? ''}
              genderRestriction={event.gender_restriction ?? null}
              eventId={event.id}
              currentUserId={user?.id ?? null}
              currentUserEmail={profile?.email ?? user?.email ?? null}
              currentUserAccountKind={profile?.account_kind ?? 'member'}
              currentUserIsApprovedMember={
                profile?.application_status === 'approved' && profile?.account_kind === 'member'
              }
              currentUserName={profile?.full_name ?? ''}
              currentUserPhone={profile?.phone ?? ''}
              currentUserSkillLevel={profile?.tennis_skill_level ?? null}
              currentUserGender={profile?.gender ?? null}
              format={event.tournament_format}
              config={event.tournament_config ?? {}}
              rulesHtml={event.tournament_rules_html ?? ''}
              detailsPublic={event.tournament_details_public !== false}
              allowNonMemberRegistration={event.allow_non_member_registration === true}
              eventStatus={event.status}
              startsAt={event.starts_at}
              endsAt={event.ends_at}
              locationQuery={club?.location_query || event.location || ''}
              registrationOpensAt={event.registration_opens_at}
              registrationClosesAt={event.registration_closes_at}
              priceCents={event.price_cents ?? 0}
              interacEnabled={interacEnabled}
              leagueTournament={isLeagueTournament}
              leagueId={event.social_doubles_ladder_id ?? null}
              leagueGender={league?.gender ?? null}
              courtCount={event.court_count ?? 4}
              leagueStandingsBefore={leagueStandingsBefore}
              leagueStandingsAfter={leagueStandingsAfter}
              leagueHasResults={
                Array.isArray(leagueEventMatches) &&
                leagueEventMatches.some((match) => ['completed', 'bye'].includes(match.status))
              }
              winnersAnnounced={event.tournament_winners_announced === true}
              announcedWinners={event.tournament_winners ?? []}
            />
          </>
        ) : (
          <>
            {isManager && event.event_type !== 'party' && (
              <EventEditManagement eventId={event.id} startsAt={event.starts_at} assignmentOnly />
            )}
            <EventDetailClient
              event={displayEvent}
              roster={rosterRows}
              courts={courts ?? []}
              scores={scores ?? []}
              currentUserId={user?.id ?? null}
              currentRegistrationId={registration?.id ?? null}
              currentGuestCount={Number(registration?.guest_count ?? 0)}
              currentStatus={registration?.status ?? null}
              currentPaymentStatus={registration?.payment_status ?? null}
              locationQuery={club?.location_query || event.location || ''}
              isManager={isManager}
              isAdmin={profile?.application_status === 'approved' && profile.role === 'admin'}
              canViewParticipants={canViewParticipants}
              remainingSpots={Math.max(0, event.capacity - (publicCount?.confirmed_count ?? 0))}
              interacEnabled={interacEnabled}
            />
          </>
        )}
      </div>
      <ClubSiteFooter club={club} />
    </main>
  );
}
