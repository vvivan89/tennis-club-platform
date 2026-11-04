import type { Match, Pair, Participant } from '@/components/tournament-public-view-types';

export function getTournamentLeagueOverviewData(
  pairs: Pair[],
  participants: Participant[],
  matches: Match[],
  activeCategory: string,
) {
  const activeLeaguePairs = pairs.filter(
    (pair) => pair.category === activeCategory && pair.status !== 'withdrawn',
  );
  const unpairedLeagueParticipants = participants.filter(
    (participant) =>
      participant.category === activeCategory &&
      participant.status === 'registered' &&
      !activeLeaguePairs.some(
        (pair) => pair.player_one_id === participant.id || pair.player_two_id === participant.id,
      ),
  );
  const leagueScheduledMatches = matches.filter((match) => match.court_number);
  const leagueTimeSlots = Array.from(
    new Set(leagueScheduledMatches.map((match) => match.scheduled_at || 'unscheduled')),
  ).sort((a, b) => {
    if (a === 'unscheduled') return 1;
    if (b === 'unscheduled') return -1;
    return a.localeCompare(b);
  });
  const leaguePairs = pairs.filter((pair) => pair.status !== 'withdrawn');
  return {
    activeLeaguePairs,
    unpairedLeagueParticipants,
    leagueScheduledMatches,
    leagueTimeSlots,
    leaguePairs,
  };
}
