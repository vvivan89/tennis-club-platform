import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { AdminNav } from '@/components/admin-nav';
import { ClubSiteFooter } from '@/components/club-site-footer';
import { EventManagementForm } from '@/components/event-management-form';
export default async function CreateEventPage() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/admin/events/create');
  const { data: profile } = await db
    .from('profiles')
    .select('role,full_name,email')
    .eq('id', user.id)
    .maybeSingle();
  if (!['admin', 'organizer'].includes(profile?.role ?? '')) redirect('/member/dashboard');
  const { data: club } = await db
    .from('club_settings')
    .select('club_name,short_name,social_links')
    .eq('id', 1)
    .maybeSingle();
  const { data: organizers } =
    profile?.role === 'admin'
      ? await db
          .from('profiles')
          .select('id,full_name,email,role')
          .in('role', ['admin', 'organizer'])
          .order('full_name')
      : { data: [] };
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Event management</p>
        <h1 className="section-title">Create Event</h1>
        <p className="mb-7 mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          Create a single session or a recurring series. Each recurring session receives its own
          registration window, capacity, waitlist, court assignments, and history. Multi-day
          sessions are supported.
        </p>
        <EventManagementForm
          currentUserId={user.id}
          organizerOptions={organizers ?? []}
          showOrganizerField={profile?.role === 'admin'}
        />
      </div>
      <ClubSiteFooter club={club} />
    </main>
  );
}
