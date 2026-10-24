import type { Metadata } from 'next';
import './styles.css';
import { SiteHeaderStateProvider } from '@/components/site-header-state';
import { MemberChatNotifications } from '@/components/member-chat-notifications';

export const metadata: Metadata = {
  title: 'Port Coquitlam Tennis Club (PCTC)',
  description: 'Membership, events, programs, and tournaments for your tennis club.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA">
      <body>
        <SiteHeaderStateProvider>
          {children}
          <MemberChatNotifications />
        </SiteHeaderStateProvider>
      </body>
    </html>
  );
}
