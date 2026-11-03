import type { TournamentConfig } from '@/lib/tournament-config';
import type { GroupOverride, Match } from '@/components/tournament-public-view-types';
import type { GroupStanding } from '@/components/tournament-public-group-standings';

export function TournamentPublicGroupStandingsPanel({
  groupStandings,
  format,
  activeCategory,
  hasAdminControls,
  onOverride,
  rankingColumns,
  rankingColumnLabel,
  isOwnEntry,
  groupOverrides,
  enabledPhases,
  config,
  visibleMatches,
}: {
  groupStandings: GroupStanding[];
  format: string | null;
  activeCategory: string;
  hasAdminControls: boolean;
  onOverride: (group: GroupStanding) => void;
  rankingColumns: string[];
  rankingColumnLabel: Record<string, string>;
  isOwnEntry: (entryId: string) => boolean;
  groupOverrides: GroupOverride[];
  enabledPhases: NonNullable<TournamentConfig['phases']>;
  config: TournamentConfig | null;
  visibleMatches: Match[];
}) {
  const visibleGroups = groupStandings.filter(
    (group) =>
      (format === 'team' || group.category === activeCategory) && group.standings.length > 0,
  );
  if (!visibleGroups.length) return null;

  return (
    <details open className="space-y-4">
      <summary className="cursor-pointer text-lg font-semibold">Group standings</summary>
      {visibleGroups.map((group) => (
        <div key={`${group.category}-${group.group}`}>
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium">Group {group.group}</h4>
            {hasAdminControls && (
              <button
                type="button"
                onClick={() => onOverride(group)}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
              >
                Override standings
              </button>
            )}
          </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full table-fixed min-w-[36rem] text-left text-sm">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="p-2">#</th>
                  <th className="w-[40%] p-2">Team</th>
                  <th className="p-2">Played</th>
                  {rankingColumns.map((key) => (
                    <th key={key} className="p-2">
                      {rankingColumnLabel[key]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.standings.map((row, index) => {
                  const rankingOverride = groupOverrides.find(
                    (item) =>
                      item.category === group.category &&
                      item.group_number === group.group &&
                      item.entry_id === row.id &&
                      item.override_type === 'ranking',
                  );
                  const promotionOverride = groupOverrides.find(
                    (item) =>
                      item.category === group.category &&
                      item.group_number === group.group &&
                      item.entry_id === row.id &&
                      item.override_type === 'promotion',
                  );
                  const promotionEnabled =
                    format === 'team'
                      ? enabledPhases.team_round_robin !== false &&
                        enabledPhases.team_knockout !== false
                      : enabledPhases.round_robin !== false &&
                        enabledPhases.final_knockout !== false;
                  const automaticallyPromoted =
                    group.standings.some((standing) => standing.played > 0) &&
                    promotionEnabled &&
                    index < Math.max(1, Number(config?.promoted_teams_per_group ?? 2));
                  const pendingPromotion =
                    !visibleMatches.some(
                      (match) =>
                        match.phase.includes('round_robin') &&
                        match.group_number === group.group &&
                        match.category === group.category,
                    ) ||
                    visibleMatches.some(
                      (match) =>
                        match.phase.includes('round_robin') &&
                        match.group_number === group.group &&
                        match.category === group.category &&
                        match.status !== 'completed',
                    );
                  const promoted =
                    promotionOverride?.override_value === 1 ||
                    (!promotionOverride && automaticallyPromoted);

                  return (
                    <tr
                      key={row.id}
                      className={`border-t border-border ${isOwnEntry(row.id) ? 'bg-primary/10 font-semibold' : ''}`}
                    >
                      <td className="p-2">{index + 1}</td>
                      <td className="p-2 font-medium">
                        {row.name}
                        {rankingOverride &&
                          rankingOverride.override_value !== row.automaticPosition && (
                            <span
                              title={rankingOverride.reason}
                              className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-800 dark:text-amber-300"
                            >
                              !
                            </span>
                          )}
                        {promotionOverride?.override_value !== 0 && promoted && (
                          <span className="ml-2 inline-flex rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            {promotionOverride?.override_value === 1 || !pendingPromotion
                              ? 'Promoted'
                              : 'Pending promotion'}
                          </span>
                        )}
                      </td>
                      <td className="p-2">{row.played}</td>
                      {rankingColumns.map((key) => (
                        <td key={key} className="p-2">
                          {key === 'points'
                            ? row.points
                            : key === 'matches_won'
                              ? row.wins
                              : key === 'sets_won'
                                ? row.setsFor
                                : key === 'games_won'
                                  ? row.gamesFor
                                  : key === 'set_difference'
                                    ? row.setsFor - row.setsAgainst
                                    : row.gamesFor - row.gamesAgainst}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {[
            ...new Set(
              groupOverrides
                .filter(
                  (item) => item.category === group.category && item.group_number === group.group,
                )
                .map((item) => item.reason)
                .filter(Boolean),
            ),
          ].map((reason) => (
            <p key={reason} className="mt-2 text-sm text-muted-foreground">
              Standings override: {reason}
            </p>
          ))}
        </div>
      ))}
    </details>
  );
}
