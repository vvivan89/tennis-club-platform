import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Match } from '@/components/tournament-public-view-types';

export function useTournamentMatchLineupRefresh({
  matches,
  eventStartsAt,
  setRegistrationRefresh,
}: {
  matches: Match[];
  eventStartsAt: string;
  setRegistrationRefresh: Dispatch<SetStateAction<number>>;
}) {
  useEffect(() => {
    const now = Date.now();
    const nextStart = matches
      .map((match) => new Date(match.scheduled_at || eventStartsAt).getTime())
      .filter((time) => Number.isFinite(time) && time > now)
      .sort((a, b) => a - b)[0];
    if (nextStart === undefined) return;

    const timer = window.setTimeout(
      () => setRegistrationRefresh((current) => current + 1),
      Math.max(0, nextStart - now + 50),
    );
    return () => window.clearTimeout(timer);
  }, [matches, eventStartsAt, setRegistrationRefresh]);
}
