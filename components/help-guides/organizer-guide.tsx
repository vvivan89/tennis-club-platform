'use client';

import { Callout, LinkButton, SectionNav, Topic } from '@/components/help-guide-primitives';
import { AdminEventsGuide } from '@/components/help-guides/admin/events-guide';
import { AdminTournamentsGuide } from '@/components/help-guides/admin/tournaments-guide';
import { sharedEventTournamentTopics } from '@/components/help-guides/event-tournament-topics';
import { helpTopicLinks, useHelpGuideNavigation } from '@/components/help-guides/navigation';

const tabs = [
  ['dashboard', 'Dashboard'],
  ['events', 'Events'],
  ['tournaments', 'Tournaments'],
] as const;

const topics = [
  ['dashboard', 'organizer-dashboard', 'Organizer dashboard'],
  ...sharedEventTournamentTopics,
] as const;

export function OrganizerHelpTopicNav() {
  return (
    <SectionNav ariaLabel="Organizer help topics" collapsible links={helpTopicLinks(topics)} />
  );
}

export function OrganizerHelpGuide() {
  const { activeTab, selectTab } = useHelpGuideNavigation(tabs, topics, 'dashboard');

  return (
    <section id="organizer-guide" className="scroll-mt-24 space-y-6">
      <div role="tablist" aria-label="Organizer help sections" className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`organizer-help-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="organizer-help-panel"
            onClick={() => selectTab(id)}
            className={`rounded-md border px-4 py-2 text-sm ${activeTab === id ? 'border-primary bg-secondary font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="organizer-help-panel"
        role="tabpanel"
        aria-labelledby={`organizer-help-tab-${activeTab}`}
        className="space-y-5"
      >
        {activeTab === 'dashboard' ? (
          <Topic id="organizer-dashboard" title="Use the Organizer dashboard to triage events">
            <p>
              The dashboard includes events you created or that are assigned to you. Its upcoming
              and past counts and registration totals help you spot sessions that need attention.
              Review the event date, publication status, capacity, confirmed registrations, and
              waitlist count; select Manage to open an event, or use Events for your complete list.
            </p>
            <p>
              The dashboard totals are a quick overview. Open each event to verify its participant,
              payment, court, and match records before making changes.
            </p>
            <p className="flex flex-wrap gap-4">
              <LinkButton href="/admin/organizer-dashboard">Organizer dashboard</LinkButton>
              <LinkButton href="/admin/events">Your event list</LinkButton>
            </p>
          </Topic>
        ) : activeTab === 'events' ? (
          <>
            <Callout>
              Organizers can manage events they created or that are assigned to them. Event
              configuration and management guidance below is shared with the Admin guide so the
              instructions stay consistent. Tournament draw and results workflows have their own
              tab. The member, payment, publication, and club settings tabs are not part of the
              Organizer Portal.
            </Callout>
            <AdminEventsGuide />
          </>
        ) : (
          <AdminTournamentsGuide />
        )}
      </div>
    </section>
  );
}
