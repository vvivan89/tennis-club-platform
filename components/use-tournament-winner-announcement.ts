import { useEffect, useMemo, useState } from 'react';
import { useTimedFeedback } from '@/hooks/use-timed-feedback';
import { buildTournamentWinnerSummaries } from '@/components/tournament-winner-summaries';
import type { GroupStanding } from '@/components/tournament-public-group-standings';
import type { Match, Pair, Team } from '@/components/tournament-public-view-types';
import type { TournamentConfig } from '@/lib/tournament-config';
import { haveAllScheduledTournamentMatchesBeenPlayed } from '@/lib/tournament-winner-announcement';

type WinnerSummary = { category: string; winners: string[] };

export function useTournamentWinnerAnnouncement({
  db,
  eventId,
  isManager,
  initialWinnersAnnounced,
  initialAnnouncedWinners,
  matches,
  teams,
  pairs,
  config,
  format,
  groupStandings,
}: {
  db: ReturnType<typeof import('@/lib/supabase-browser').createSupabaseBrowserClient>;
  eventId: string;
  isManager: boolean;
  initialWinnersAnnounced: boolean;
  initialAnnouncedWinners: WinnerSummary[];
  matches: Match[];
  teams: Team[];
  pairs: Pair[];
  config: TournamentConfig | null;
  format: string | null;
  groupStandings: GroupStanding[];
}) {
  const [winnersAnnounced, setWinnersAnnounced] = useState(initialWinnersAnnounced);
  const [announcedWinners, setAnnouncedWinners] = useState(initialAnnouncedWinners);
  const feedback = useTimedFeedback();
  const winnerSummaries = useMemo(
    () => buildTournamentWinnerSummaries({ matches, teams, pairs, config, format, groupStandings }),
    [matches, teams, pairs, config, format, groupStandings],
  );
  const allScheduledMatchesPlayed = haveAllScheduledTournamentMatchesBeenPlayed(matches);
  const visibleWinnerSummaries = announcedWinners.length ? announcedWinners : winnerSummaries;

  useEffect(() => {
    setWinnersAnnounced(initialWinnersAnnounced);
    setAnnouncedWinners(initialAnnouncedWinners);
  }, [initialWinnersAnnounced, initialAnnouncedWinners]);

  async function toggleWinnerAnnouncement() {
    if (!isManager || feedback.busy) return;
    const nextAnnounced = !winnersAnnounced;
    feedback.setBusy(true);
    feedback.setError('');
    feedback.setMessage('');
    try {
      const { error } = await db
        .from('events')
        .update({
          tournament_winners_announced: nextAnnounced,
          tournament_winners: nextAnnounced ? winnerSummaries : [],
        })
        .eq('id', eventId);
      if (error) {
        feedback.setError(error.message || 'Could not update the winners announcement.');
        return;
      }
      setWinnersAnnounced(nextAnnounced);
      setAnnouncedWinners(nextAnnounced ? winnerSummaries : []);
      feedback.setMessage(
        nextAnnounced ? 'Tournament winners announced.' : 'Winners announcement removed.',
      );
    } catch (error) {
      feedback.setError(
        error instanceof Error ? error.message : 'Could not update the winners announcement.',
      );
    } finally {
      feedback.setBusy(false);
    }
  }

  return {
    announcementFeedback: feedback,
    allScheduledMatchesPlayed,
    toggleWinnerAnnouncement,
    visibleWinnerSummaries: winnersAnnounced ? visibleWinnerSummaries : [],
    winnerSummaries,
    winnersAnnounced,
  };
}
