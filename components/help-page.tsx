import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getClubDisplay } from '@/lib/club-display';
import { canAccessHelpGuide, type HelpGuide } from '@/lib/help-access';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { HelpCenter } from '@/components/help-center';
import { HelpNav } from '@/components/help-nav';

export async function HelpPage({ guide }: { guide: HelpGuide }) {
  const db = await createSupabaseServerClient();
  const [
    { data: club },
    {
      data: { user },
    },
  ] = await Promise.all([
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
    db.auth.getUser(),
  ]);

  let role: string | null = null;
  let approved = false;
  if (user) {
    const { data: profile } = await db
      .from('profiles')
      .select('role,application_status')
      .eq('id', user.id)
      .maybeSingle();
    role = profile?.role ?? null;
    approved = profile?.application_status === 'approved';
  }

  if (!canAccessHelpGuide(guide, role, approved)) redirect('/help/public');

  const { clubName, shortName, socialLinks } = getClubDisplay(club);
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} active="help" />
      <HelpNav role={role} approved={approved} />
      <HelpCenter guide={guide} />
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socialLinks} />
    </main>
  );
}
