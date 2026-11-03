import { CircleHelp } from 'lucide-react';
import type { HelpGuide } from '@/lib/help-access';
import { LinkButton, SectionNav } from '@/components/help-guide-primitives';
import { PublicHelpGuide } from '@/components/help-guides/public-guide';
import { OrganizerHelpGuide } from '@/components/help-guides/organizer-guide';
import { AdminHelpGuide } from '@/components/help-guides/admin-guide';
import { MemberHelpGuide } from '@/components/help-guides/member-guide';

type HelpCenterProps = { guide: HelpGuide };

export function HelpCenter({ guide }: HelpCenterProps) {
  const titles: Record<HelpGuide, string> = {
    public: 'Public guide',
    member: 'Member guide',
    organizer: 'Organizer guide',
    admin: 'Admin guide',
  };
  const descriptions: Record<HelpGuide, string> = {
    public:
      'Find public events, understand eligibility and registration, and enter tournaments that allow guest registration.',
    member:
      'Manage the profile details, event entries, competition participation, and payments attached to your member account.',
    organizer:
      'Configure events and competitions, then manage entries, draws, courts, and results for events you own or were assigned.',
    admin:
      'Manage club-wide events, member access, payments, membership plans, publications, and documents.',
  };
  const sectionLinks: Record<HelpGuide, Array<{ href: string; label: string }>> = {
    public: [
      { href: '#visitor-events', label: 'Browse events and eligibility' },
      { href: '#visitor-tournament', label: 'Public tournament registration' },
    ],
    member: [
      { href: '#member-profile', label: 'Profile and eligibility' },
      { href: '#member-events', label: 'Event registration' },
      { href: '#member-competitions', label: 'Tournament, League, ladder entry' },
      { href: '#member-payments', label: 'Membership and payments' },
      { href: '#member-results', label: 'Results and match scores' },
      { href: '#member-rankings', label: 'Club rankings' },
      { href: '#member-resources', label: 'Gallery and documents' },
      { href: '#member-chat', label: 'Member chat' },
    ],
    organizer: [
      { href: '#organizer-dashboard', label: 'Organizer dashboard' },
      { href: '#organizer-event-setup', label: 'Event form: every input' },
      { href: '#organizer-competitions', label: 'Tournament, League, ladder setup' },
      { href: '#organizer-running', label: 'Participants, courts, and results' },
    ],
    admin: [
      { href: '#admin-dashboard', label: 'Admin dashboard' },
      { href: '#admin-event-setup', label: 'Event ownership and assignment' },
      { href: '#admin-competition-setup', label: 'Competition oversight' },
      { href: '#admin-ranking-controls', label: 'How standings are maintained' },
      { href: '#admin-payments', label: 'Payments and refunds' },
      { href: '#admin-members', label: 'Applications and membership' },
      { href: '#admin-publishing', label: 'Website and documents' },
    ],
  };

  return (
    <div className="page-container flex-1 py-10 sm:py-14">
      <header className="mb-9 rounded-2xl border border-border bg-card p-6 sm:p-9">
        <p className="eyebrow">PCTC Help</p>
        <h1 className="section-title mt-2">{titles[guide]}</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
          {descriptions[guide]}
        </p>
        <div className="mt-6">
          <SectionNav links={sectionLinks[guide]} />
        </div>
      </header>

      {guide === 'public' && <PublicHelpGuide />}
      {guide === 'organizer' && <OrganizerHelpGuide />}
      {guide === 'admin' && <AdminHelpGuide />}
      {guide === 'member' && <MemberHelpGuide />}

      <aside className="mt-12 flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-5">
        <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">Need help with a specific entry?</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Include the event name, the player/partner involved, the payment reference if
            applicable, and what status the page shows. Do not send card details.
          </p>
          <p className="mt-2">
            <LinkButton href="/contacts">Club contact information</LinkButton>
          </p>
        </div>
      </aside>
    </div>
  );
}
