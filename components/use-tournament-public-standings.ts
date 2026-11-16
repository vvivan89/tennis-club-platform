import { useMemo } from 'react';
import { buildTournamentGroupStandings } from '@/components/tournament-public-group-standings';
import { useTournamentWinnerAnnouncement } from '@/components/use-tournament-winner-announcement';
import type {
  GroupOverride,
  TournamentPublicViewProps,
} from '@/components/tournament-public-view-types';
import type { Match, Pair, Participant, Team } from '@/components/tournament-public-view-types';
import type { TournamentConfig } from '@/lib/tournament-config';
import type { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export function useTournamentPublicStandings({
  visibleMatches,
  teams,
  pairs,
  participants,
  config,
  format,
  groupOverrides,
  db,
  eventId,
  isManager,
  initialWinnersAnnounced,
  initialAnnouncedWinners,
  matches,
}: {
  visibleMatches: Match[];
  teams: Team[];
  pairs: Pair[];
  participants: Participant[];
  config: TournamentConfig | null;
  format: string | null;
  groupOverrides: GroupOverride[];
  db: ReturnType<typeof createSupabaseBrowserClient>;
  eventId: string;
  isManager: boolean;
  initialWinnersAnnounced: boolean;
  initialAnnouncedWinners: NonNullable<TournamentPublicViewProps['announcedWinners']>;
  matches: Match[];
}) {
  const groupStandings = useMemo(
    () =>
      buildTournamentGroupStandings({
        visibleMatches,
        teams,
        pairs,
        participants,
        config,
        format,
        groupOverrides,
      }),
    [visibleMatches, teams, pairs, participants, config, format, groupOverrides],
  );
  const winnerAnnouncement = useTournamentWinnerAnnouncement({
    db,
    eventId,
    isManager,
    initialWinnersAnnounced,
    initialAnnouncedWinners,
    matches,
    teams,
    pairs,
    participants,
    config,
    format,
    groupStandings,
  });
  return { groupStandings, ...winnerAnnouncement };
}
