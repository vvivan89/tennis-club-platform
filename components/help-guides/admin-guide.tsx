'use client';

import { AdminAuditGuide } from '@/components/help-guides/admin/audit-guide';
import { AdminClubProfileGuide } from '@/components/help-guides/admin/club-profile-guide';
import { AdminDashboardGuide } from '@/components/help-guides/admin/dashboard-guide';
import { AdminDocumentsGuide } from '@/components/help-guides/admin/documents-guide';
import { AdminEventsGuide } from '@/components/help-guides/admin/events-guide';
import { AdminMembershipGuide } from '@/components/help-guides/admin/membership-guide';
import { AdminPaymentsGuide } from '@/components/help-guides/admin/payments-guide';
import { AdminPublicationsGuide } from '@/components/help-guides/admin/publications-guide';
import { AdminTournamentsGuide } from '@/components/help-guides/admin/tournaments-guide';
import { SectionNav } from '@/components/help-guide-primitives';
import { sharedEventTournamentTopics } from '@/components/help-guides/event-tournament-topics';
import { helpTopicLinks, useHelpGuideNavigation } from '@/components/help-guides/navigation';

const tabs = [
  ['dashboard', 'Dashboard'],
  ['club-profile', 'Club Profile'],
  ['membership', 'Membership'],
  ['payments', 'Payments'],
  ['events', 'Events'],
  ['tournaments', 'Tournaments'],
  ['publications', 'Publications'],
  ['documents', 'Documents'],
  ['audit-logs', 'Audit Logs'],
] as const;

const topics = [
  ['dashboard', 'admin-dashboard', 'Club dashboard'],
  ['club-profile', 'admin-club-information', 'Club information'],
  ['club-profile', 'admin-club-contacts', 'Club contacts'],
  ['membership', 'admin-applications', 'Membership applications'],
  ['membership', 'admin-invite-member', 'Invite members'],
  ['membership', 'admin-member-directory', 'Member directory'],
  ['membership', 'admin-membership-plans', 'Membership plans'],
  ['membership', 'admin-family-flow', 'Family membership'],
  ['payments', 'admin-payment-report', 'Payment report'],
  ['payments', 'admin-stripe-payment-flow', 'Stripe payments'],
  ['payments', 'admin-interac-settings', 'Interac payments'],
  ['payments', 'admin-payment-refunds', 'Refunds'],
  ...sharedEventTournamentTopics,
  ['publications', 'admin-publication-news', 'Website news'],
  ['publications', 'admin-publication-announcements', 'Email announcements'],
  ['publications', 'admin-publication-gallery', 'Photo gallery'],
  ['documents', 'admin-legal-documents', 'Legal documents'],
  ['documents', 'admin-uploaded-documents', 'Member documents'],
  ['audit-logs', 'admin-audit-logs', 'Audit logs'],
] as const;

type AdminGuideTab = (typeof tabs)[number][0];

export function AdminHelpTopicNav() {
  return <SectionNav ariaLabel="Admin help topics" collapsible links={helpTopicLinks(topics)} />;
}

function tabContent(tab: AdminGuideTab) {
  switch (tab) {
    case 'dashboard':
      return <AdminDashboardGuide />;
    case 'club-profile':
      return <AdminClubProfileGuide />;
    case 'membership':
      return <AdminMembershipGuide />;
    case 'payments':
      return <AdminPaymentsGuide />;
    case 'events':
      return <AdminEventsGuide />;
    case 'tournaments':
      return <AdminTournamentsGuide />;
    case 'publications':
      return <AdminPublicationsGuide />;
    case 'documents':
      return <AdminDocumentsGuide />;
    case 'audit-logs':
      return <AdminAuditGuide />;
  }
}

export function AdminHelpGuide() {
  const { activeTab, selectTab } = useHelpGuideNavigation(tabs, topics, 'dashboard');

  return (
    <section id="admin-guide" className="scroll-mt-24 space-y-6">
      <div
        role="tablist"
        aria-label="Admin help sections"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`admin-help-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="admin-help-panel"
            onClick={() => selectTab(id)}
            className={`rounded-md border px-4 py-2 text-sm ${activeTab === id ? 'border-primary bg-secondary font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="admin-help-panel"
        role="tabpanel"
        aria-labelledby={`admin-help-tab-${activeTab}`}
        className="space-y-5"
      >
        {tabContent(activeTab)}
      </div>
    </section>
  );
}
