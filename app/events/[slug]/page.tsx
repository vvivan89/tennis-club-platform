import { notFound, redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { EventDetailClient } from '@/components/event-detail-client';
import { EventEditManagement } from '@/components/event-edit-management';
import { eventPath } from '@/lib/event-slug';

export default async function EventDetailsPage({ params }: { params: { slug: string } }) {
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
  if (!resolvedEvent) {
    const { data: alias } = await db
      .from('event_slug_aliases')
      .select('event_id')
      .eq('slug', params.slug)
      .maybeSingle();
    if (alias?.event_id) {
      const { data: aliasedEvent } = await db
        .from('events')
        .select('*')
        .eq('id', alias.event_id)
        .maybeSingle();
      if (aliasedEvent) resolvedEvent = aliasedEvent;
    }
  }
  const event = resolvedEvent;
  if (!event) notFound();
  if (event.slug && params.slug !== event.slug)
    redirect(eventPath({ id: event.id, slug: event.slug }));
  if (!['published', 'cancelled'].includes(event.status)) {
    const { data: profile } = user
      ? await db.from('profiles').select('role,application_status').eq('id', user.id).maybeSingle()
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
    { data: organizerContacts },
  ] = await Promise.all([
    user
      ? db
          .from('registrations')
          .select('id,status,queue_position,created_at,payment_status')
          .eq('event_id', event.id)
          .eq('user_id', user.id)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? db.from('profiles').select('role,application_status').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('event_public_counts').select('confirmed_count').eq('event_id', event.id).maybeSingle(),
    user
      ? db.rpc('event_organizer_contacts', { p_event_id: event.id })
      : Promise.resolve({ data: [] }),
  ]);
  const isManager =
    profile?.application_status === 'approved' &&
    (profile?.role === 'admin' ||
      (profile?.role === 'organizer' && (event.organizer_id ?? event.created_by) === user?.id));
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
  const canViewParticipants = isManager || (hasPaidMembership && registered);
  const [{ data: roster }, { data: courts }, { data: scores }] = await Promise.all([
    canViewParticipants
      ? db
          .from('event_roster')
          .select(
            'registration_id,user_id,status,payment_status,queue_position,full_name,avatar_url,tennis_skill_level',
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
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        clubName={club?.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club?.short_name || 'PCTC'}
      />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Club event</p>
        <h1 className="section-title">{event.title}</h1>
        {!!organizerContacts?.length && (
          <section
            className="my-6 border-y border-border py-5"
            aria-labelledby="event-organizer-title"
          >
            <h2 id="event-organizer-title" className="text-lg font-semibold">
              Event organizer
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {organizerContacts.map(
                (contact: {
                  organizer_id: string;
                  organizer_name: string;
                  position: string;
                  emails: string[];
                  phones: string[];
                }) => (
                  <div key={`${contact.organizer_id}-${contact.position}`}>
                    <p className="font-medium">{contact.organizer_name}</p>
                    <p className="text-sm text-muted-foreground">{contact.position}</p>
                    {!!contact.emails?.length && (
                      <ul className="mt-2 space-y-1 text-sm">
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
                      <ul className="mt-1 space-y-1 text-sm">
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
                ),
              )}
            </div>
          </section>
        )}
        {isManager && (
          <EventEditManagement eventId={event.id} startsAt={event.starts_at} assignmentOnly />
        )}
        <EventDetailClient
          event={event}
          roster={rosterRows}
          courts={courts ?? []}
          scores={scores ?? []}
          currentUserId={user?.id ?? null}
          currentRegistrationId={registration?.id ?? null}
          currentStatus={registration?.status ?? null}
          currentPaymentStatus={registration?.payment_status ?? null}
          locationQuery={club?.location_query || event.location || ''}
          isManager={isManager}
          canViewParticipants={canViewParticipants}
          remainingSpots={Math.max(0, event.capacity - (publicCount?.confirmed_count ?? 0))}
          interacEnabled={interacEnabled}
        />
      </div>
      <SiteFooter
        clubName={club?.club_name}
        shortName={club?.short_name}
        socialLinks={
          Array.isArray(club?.social_links) ? (club.social_links as { url: string }[]) : []
        }
      />
    </main>
  );
}
