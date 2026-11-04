import { useMemo } from 'react';
import { knockoutStageLabel, type TournamentConfig } from '@/lib/tournament-config';
import { compareByScheduleThenCourt, roundNumbersByMatch } from '@/lib/tournament-match';
import type { Match, Pair, Team } from '@/components/tournament-management-types';

export function useTournamentAdminMatchView({
  matches,
  isTeam,
  activeCategory,
  matchCategory,
  matchPhase,
  matchGrouping,
  config,
  courtCount,
  teams,
  pairs,
}: {
  matches: Match[];
  isTeam: boolean;
  activeCategory: string;
  matchCategory: string;
  matchPhase: string;
  matchGrouping: 'group' | 'round';
  config: TournamentConfig | null;
  courtCount: number;
  teams: Team[];
  pairs: Pair[];
}) {
  const isRoundRobinPhase = matchPhase.includes('round_robin');
  const adminRoundByMatch = useMemo(
    () =>
      roundNumbersByMatch(
        matches
          .filter(
            (match) =>
              match.category === matchCategory &&
              match.phase === matchPhase &&
              match.status !== 'cancelled',
          )
          .sort(compareByScheduleThenCourt),
        isTeam,
      ),
    [matches, matchCategory, matchPhase, isTeam],
  );
  const adminMatchList = useMemo(() => {
    const list = matches.filter(
      (match) =>
        match.category === (isTeam ? matchCategory : activeCategory) && match.phase === matchPhase,
    );
    return list.sort((a, b) => {
      if (matchPhase.includes('knockout')) {
        const stageDifference = a.round_number - b.round_number;
        if (stageDifference) return stageDifference;
      }
      if (isRoundRobinPhase) {
        const groupA = a.group_number ?? Number.MAX_SAFE_INTEGER;
        const groupB = b.group_number ?? Number.MAX_SAFE_INTEGER;
        const roundA = adminRoundByMatch.get(a.id) ?? a.round_number;
        const roundB = adminRoundByMatch.get(b.id) ?? b.round_number;
        const groupOrRound = matchGrouping === 'group' ? groupA - groupB : roundA - roundB;
        if (groupOrRound) return groupOrRound;
      }
      const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      return (
        timeA - timeB ||
        (a.court_number ?? Number.MAX_SAFE_INTEGER) - (b.court_number ?? Number.MAX_SAFE_INTEGER)
      );
    });
  }, [
    matches,
    isTeam,
    activeCategory,
    matchCategory,
    matchPhase,
    isRoundRobinPhase,
    adminRoundByMatch,
    matchGrouping,
  ]);
  const courtScheduleConflicts = useMemo(() => {
    const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60)) * 60000;
    const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15)) * 60000;
    const conflicts: Array<{
      court: number;
      previous: Match;
      current: Match;
      severity: 'danger' | 'warning';
    }> = [];
    for (let court = 1; court <= Math.max(1, courtCount); court++) {
      const scheduled = matches
        .filter(
          (match) =>
            match.court_number === court && match.status !== 'cancelled' && !!match.scheduled_at,
        )
        .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
      for (let index = 1; index < scheduled.length; index++) {
        const previous = scheduled[index - 1];
        const current = scheduled[index];
        const previousEnd = new Date(previous.scheduled_at!).getTime() + duration;
        const currentStart = new Date(current.scheduled_at!).getTime();
        if (currentStart < previousEnd)
          conflicts.push({ court, previous, current, severity: 'danger' });
        else if (currentStart < previousEnd + gap)
          conflicts.push({ court, previous, current, severity: 'warning' });
      }
    }
    return conflicts;
  }, [matches, config?.schedule?.match_minutes, config?.schedule?.break_minutes, courtCount]);

  function matchCourtTileNames(match: Match) {
    const firstId = isTeam ? match.team_one_id : match.pair_one_id;
    const secondId = isTeam ? match.team_two_id : match.pair_two_id;
    const nameFor = (id: string | null) => {
      if (!id) return 'TBD';
      if (isTeam) return teams.find((team) => team.id === id)?.name ?? 'TBD';
      const pair = pairs.find((candidate) => candidate.id === id);
      return pair
        ? `${pair.player_one_name || 'Player'} + ${pair.player_two_name || 'Player'}`
        : 'TBD';
    };
    const stage =
      match.phase.includes('knockout') || match.phase === 'team_knockout'
        ? `${knockoutStageLabel(match.round_number, Math.max(1, ...matches.filter((item) => item.phase === match.phase).map((item) => item.round_number)))} ${match.match_number}`
        : match.group_number
          ? `Group ${match.group_number}`
          : 'Round robin';
    return { players: `${nameFor(firstId)} vs ${nameFor(secondId)}`, stage };
  }

  return {
    isRoundRobinPhase,
    adminRoundByMatch,
    adminMatchList,
    courtScheduleConflicts,
    matchCourtTileNames,
  };
}
