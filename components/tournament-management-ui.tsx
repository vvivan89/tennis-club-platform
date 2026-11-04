import type { ReactNode } from 'react';
import type { TournamentConfig } from '@/lib/tournament-config';
import { filterTournamentAuditRows } from '@/components/use-tournament-court-actions';
import type { Match, Pair, Participant } from '@/components/tournament-management-types';
import type { TournamentAuditRow } from '@/components/tournament-audit-log';
import { tournamentGroupCount } from '@/lib/tournament-groups';

export function getTournamentManagementUiSettings(config: TournamentConfig | null) {
  const phases = [
    ['round_robin', 'Round robin'],
    ['preliminary_knockout', 'Preliminary knockout'],
    ['final_knockout', 'Final knockout'],
    ['team_round_robin', 'Team round robin'],
    ['team_knockout', 'Team knockout'],
  ] as const;
  const groupOptions = Array.from(
    { length: tournamentGroupCount(config) },
    (_, index) => index + 1,
  ).map((group) => (
    <option key={group} value={group}>
      Group {group}
    </option>
  ));
  const enabledPhases = config?.phases ?? {
    round_robin: true,
    preliminary_knockout: false,
    final_knockout: true,
  };
  const scheduleTimings = {
    duration: Math.max(30, Number(config?.schedule?.match_minutes ?? 60)),
    breakMinutes: Math.max(10, Number(config?.schedule?.break_minutes ?? 15)),
  };
  return { phases, groupOptions: groupOptions as ReactNode, enabledPhases, scheduleTimings };
}

export function getVisibleTournamentAuditRows(
  auditRows: TournamentAuditRow[],
  isTeam: boolean,
  activeCategory: string,
  participants: Participant[],
  pairs: Pair[],
  matches: Match[],
) {
  return filterTournamentAuditRows({
    auditRows,
    isTeam,
    activeCategory,
    participants,
    pairs,
    matches,
  });
}
