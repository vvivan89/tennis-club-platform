import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import './styles.css';
import { SiteHeaderStateProvider } from '@/components/site-header-state';
import { MemberChatNotifications } from '@/components/member-chat-notifications';
import { PageTitle } from '@/components/page-title';
import { ClubThemeProvider } from '@/components/club-theme-provider';
import { BetaNotice } from '@/components/beta-notice';

export async function generateMetadata(): Promise<Metadata> {
  let shortName = 'Tennis Club';
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.from('club_settings').select('short_name').eq('id', 1).maybeSingle();
    shortName = data?.short_name || shortName;
  } catch {
    // Metadata should remain available during first setup before database configuration.
  }
  return {
    title: shortName,
    description: 'Membership, events, programs, and tournaments for your tennis club.',
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA" data-accent="green" suppressHydrationWarning>
      <body>
        <ClubThemeProvider>
          <SiteHeaderStateProvider>
            <BetaNotice />
            <PageTitle />
            {children}
            <MemberChatNotifications />
          </SiteHeaderStateProvider>
        </ClubThemeProvider>
      </body>
    </html>
  );
}
