'use client';

import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { useSiteHeaderState } from '@/components/site-header-state';
import { usePendingTournamentInvitations } from '@/components/use-pending-tournament-invitations';

export function PendingTournamentInvitations() {
  const { approved, isAdmin, isOrganizer } = useSiteHeaderState();
  const invitations = usePendingTournamentInvitations(approved && !isAdmin && !isOrganizer);
  if (!invitations.length) return null;

  return (
    <section
      aria-labelledby="pending-tournament-invitations-title"
      className="mb-8 rounded-xl border border-warning/40 bg-warning/5 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground dark:text-warning-foreground" />
        <div className="min-w-0 flex-1">
          <h2 id="pending-tournament-invitations-title" className="font-semibold">
            Tournament invitations awaiting your confirmation
          </h2>
          <ul className="mt-3 space-y-2">
            {invitations.map((invitation) => (
              <li key={invitation.participantId}>
                <Link
                  className="font-medium text-primary underline underline-offset-4"
                  href={`/events/${encodeURIComponent(invitation.eventSlug || invitation.eventId)}?confirm_partner=${encodeURIComponent(invitation.participantId)}`}
                >
                  {invitation.eventTitle}
                </Link>
                <span className="ml-2 text-sm text-muted-foreground">
                  {new Date(invitation.startsAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
