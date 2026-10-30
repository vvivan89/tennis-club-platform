import type { Metadata } from 'next';
import './styles.css';
import { SiteHeaderStateProvider } from '@/components/site-header-state';
import { MemberChatNotifications } from '@/components/member-chat-notifications';
import { PageTitle } from '@/components/page-title';

export const metadata: Metadata = {
  title: 'Port Coquitlam Tennis Club (PCTC)',
  description: 'Membership, events, programs, and tournaments for your tennis club.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA">
      <body>
        <SiteHeaderStateProvider>
          <PageTitle />
          {children}
          <MemberChatNotifications />
        </SiteHeaderStateProvider>
      </body>
    </html>
  );
}
