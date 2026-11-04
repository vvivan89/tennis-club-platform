type ScheduledTournamentMatch = {
  status: string;
  winner_side: number | null;
};

/** True once every actual (non-bye, non-cancelled) match has a recorded outcome. */
export function haveAllScheduledTournamentMatchesBeenPlayed(matches: ScheduledTournamentMatch[]) {
  const scheduledMatches = matches.filter(
    (match) => match.status !== 'bye' && match.status !== 'cancelled',
  );
  return (
    scheduledMatches.length > 0 &&
    scheduledMatches.every((match) => match.status === 'completed' && match.winner_side !== null)
  );
}
