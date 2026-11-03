'use client';

import type { Dispatch, FormEventHandler, ReactNode, SetStateAction } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import type { OwnTournamentEntry } from '@/components/tournament-public-view-types';

export function TournamentRegistrationStatus({
  priceCents,
  registrationOpen,
  currentUserId,
  allowNonMemberRegistration,
  eventSlug,
  eventId,
  guestAccessVisible,
  setGuestAccessVisible,
  requestEventGuestAccess,
  guestAccessBusy,
  guestAccessEmail,
  setGuestAccessEmail,
  guestAccessMessage,
  guestAccessError,
  leagueTournament,
  ownLeagueTeamId,
  ownEntries,
  leagueRegistrationCategory,
  isEventGuest,
  availableCategories,
  hasGenderEligibleCategory,
  children,
}: {
  priceCents: number;
  registrationOpen: boolean;
  currentUserId: string | null;
  allowNonMemberRegistration: boolean;
  eventSlug: string;
  eventId: string;
  guestAccessVisible: boolean;
  setGuestAccessVisible: Dispatch<SetStateAction<boolean>>;
  requestEventGuestAccess: FormEventHandler<HTMLFormElement>;
  guestAccessBusy: boolean;
  guestAccessEmail: string;
  setGuestAccessEmail: Dispatch<SetStateAction<string>>;
  guestAccessMessage: string;
  guestAccessError: string;
  leagueTournament: boolean;
  ownLeagueTeamId: string | null;
  ownEntries: OwnTournamentEntry[];
  leagueRegistrationCategory: string;
  isEventGuest: boolean;
  availableCategories: string[];
  hasGenderEligibleCategory: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">
        {priceCents > 0
          ? `Entry fee: ${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(priceCents / 100)} per participant, per category. Each participant has a separate entry fee; one payer may cover both entries in a pair.`
          : 'Registration is free.'}
      </p>
      {!registrationOpen ? (
        <p className="mt-3 text-sm text-muted-foreground">Registration is not currently open.</p>
      ) : !currentUserId && !allowNonMemberRegistration ? (
        <p className="mt-3 text-sm">
          <Link
            className="font-medium text-primary underline"
            href={`/login?next=${encodeURIComponent(`/events/${eventSlug || eventId}`)}`}
          >
            Sign in
          </Link>{' '}
          with an approved member account to register.
        </p>
      ) : !currentUserId ? (
        <div className="mt-4 space-y-3">
          {!guestAccessVisible ? (
            <button
              type="button"
              onClick={() => setGuestAccessVisible(true)}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Register
            </button>
          ) : (
            <form
              onSubmit={requestEventGuestAccess}
              className="max-w-lg space-y-3 rounded-lg border border-border p-4"
            >
              <p className="text-sm">
                Enter your email. We’ll send a one-time sign-in link; you can enter your
                registration details after verifying it.
              </p>
              <label className="block text-sm">
                Email
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={guestAccessEmail}
                  onChange={(event) => setGuestAccessEmail(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={guestAccessBusy}
                  className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {guestAccessBusy ? 'Sending link…' : 'Send sign-in link'}
                </button>
                <button
                  type="button"
                  onClick={() => setGuestAccessVisible(false)}
                  className="h-10 rounded-md border border-border px-4 text-sm"
                >
                  Cancel
                </button>
              </div>
              {guestAccessMessage && (
                <p role="status" className="text-sm">
                  {guestAccessMessage}
                  {guestAccessMessage.includes('Please log in as a member') && (
                    <>
                      {' '}
                      <Link
                        href={`/login?next=${encodeURIComponent(`/events/${eventSlug || eventId}`)}`}
                        className="font-medium text-primary underline"
                      >
                        Log in
                      </Link>
                    </>
                  )}
                </p>
              )}
              {guestAccessError && (
                <p role="alert" className="text-sm text-destructive">
                  {guestAccessError}
                </p>
              )}
            </form>
          )}
        </div>
      ) : leagueTournament && ownLeagueTeamId ? (
        ownEntries.some((entry) => entry.category === leagueRegistrationCategory) ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Your League team is already registered for this event.
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Your confirmed League partner will be registered with you.
          </p>
        )
      ) : leagueTournament && !isEventGuest ? (
        <p className="mt-4 text-sm text-muted-foreground">
          You can register as a single player. An organizer can pair you with a League team.
        </p>
      ) : availableCategories.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {!hasGenderEligibleCategory
            ? 'Your recorded gender does not match any enabled doubles category. Contact the organizer if it needs to be corrected for this tournament.'
            : currentUserId
              ? 'You are already registered for all available categories.'
              : 'No doubles categories are available for the entered gender.'}
        </p>
      ) : (
        children
      )}
    </>
  );
}
