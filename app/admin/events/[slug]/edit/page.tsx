import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { AdminNav } from '@/components/admin-nav';
import { ClubSiteFooter } from '@/components/club-site-footer';
import { findEventBySlugAlias } from '@/lib/event-alias';
import { EventManagementForm } from '@/components/event-management-form';
import { eventPath, eventEditPath } from '@/lib/event-slug';
import { EventEditManagement } from '@/components/event-edit-management';
export default async function EditEventPage({
  params: paramsPromise,
}: {
  params: Promise<{ slug: string }>;
}) {
  const params = await paramsPromise;
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(`/login?next=/admin/events/${params.slug}/edit`);
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!['admin', 'organizer'].includes(profile?.role ?? '')) redirect('/member/dashboard');
  const [{ data: slugEvent, error: slugError }, { data: club }] = await Promise.all([
    db.from('events').select('*').eq('slug', params.slug).maybeSingle(),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  let event = slugEvent;
  if (!event) event = await findEventBySlugAlias(db, params.slug);
  if (
    !event &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.slug)
  ) {
    const { data: legacyEvent, error: legacyError } = await db
      .from('events')
      .select('*')
      .eq('id', params.slug)
      .maybeSingle();
    if (legacyError) notFound();
    event = legacyEvent;
  }
  if (slugError && !event) notFound();
  if (!event) notFound();
  if (event.slug && params.slug !== event.slug) redirect(eventEditPath(event));
  if (profile?.role === 'organizer' && (event.organizer_id ?? event.created_by) !== user.id)
    redirect('/admin/events');
  const { data: leagueConfig } = event.social_doubles_ladder_id
    ? await db
        .from('social_doubles_ladders')
        .select('id,name,competition_type,tournament_config,tournament_rules_html,gender')
        .eq('id', event.social_doubles_ladder_id)
        .maybeSingle()
    : { data: null };
  const eventForForm =
    leagueConfig?.competition_type === 'league'
      ? {
          ...event,
          is_league_tournament: true,
          league_name: leagueConfig.name,
          ladder_name: leagueConfig.name,
          ladder_gender: leagueConfig.gender,
          tournament_config: leagueConfig.tournament_config,
          tournament_rules_html: leagueConfig.tournament_rules_html,
        }
      : event;
  const [{ data: creator }, { data: organizers }] = await Promise.all([
    event.created_by
      ? db.from('profiles').select('role').eq('id', event.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    profile?.role === 'admin'
      ? db
          .from('profiles')
          .select('id,full_name,email,role')
          .in('role', ['admin', 'organizer'])
          .eq('application_status', 'approved')
          .eq('account_kind', 'member')
          .order('full_name')
      : Promise.resolve({ data: [] }),
  ]);
  const showOrganizerField = profile?.role === 'admin' && creator?.role !== 'organizer';
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Event management</p>
        <h1 className="section-title">Edit Event</h1>
        <p className="mb-5 mt-2 text-sm text-muted-foreground">
          Edit the session details, manage registrations, and assign courts. For a recurring series,
          this page edits only this session.
        </p>
        <EventManagementForm
          event={eventForForm}
          currentUserId={user.id}
          organizerOptions={organizers ?? []}
          showOrganizerField={showOrganizerField}
        />
        <EventEditManagement
          eventId={event.id}
          startsAt={event.starts_at}
          hideRegistrationManagement={
            event.event_type === 'tournament' &&
            (event.tournament_format === 'doubles' || event.tournament_format === 'team')
          }
        />
        <p className="mt-6 text-sm">
          <Link className="text-primary underline" href={eventPath(event)}>
            View public event page
          </Link>
        </p>
      </div>
      <ClubSiteFooter club={club} />
    </main>
  );
}
