import type { TournamentConfig } from '@/lib/tournament-config';
import Image from 'next/image';
import type {
  GroupOverride,
  Match,
  Pair,
  Participant,
} from '@/components/tournament-public-view-types';
import { UserIdentity } from '@/components/user-identity';
import { hasSingleTournamentGroup } from '@/lib/tournament-groups';
import type { Team } from '@/components/tournament-public-view-types';
import type { GroupStanding } from '@/components/tournament-public-group-standings';

export function TournamentPublicGroupStandingsPanel({
  groupStandings,
  teams,
  pairs,
  participants,
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
  teams: Team[];
  pairs: Pair[];
  participants: Participant[];
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
  const singleGroup = hasSingleTournamentGroup(config);
  const visibleGroups = groupStandings.filter(
    (group) => group.category === activeCategory && group.standings.length > 0,
  );
  if (!visibleGroups.length) return null;

  return (
    <details open className="space-y-4">
      <summary className="cursor-pointer text-lg font-semibold">
        {singleGroup ? 'Standings' : 'Group standings'}
      </summary>
      {visibleGroups.map((group) => (
        <div key={`${group.category}-${group.group}`}>
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium">{singleGroup ? 'Standings' : `Group ${group.group}`}</h4>
            {hasAdminControls && group.category !== 'overall' && (
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
                    group.category !== 'overall' &&
                    (format === 'team'
                      ? enabledPhases.team_round_robin !== false &&
                        enabledPhases.team_knockout !== false
                      : enabledPhases.round_robin !== false &&
                        enabledPhases.final_knockout !== false);
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
                        <span className="inline-flex items-center gap-2">
                          {format === 'team' &&
                            teams.find((team) => team.id === row.id)?.logo_url && (
                              <Image
                                src={teams.find((team) => team.id === row.id)!.logo_url!}
                                alt=""
                                width={24}
                                height={24}
                                unoptimized
                                className="h-6 w-6 shrink-0 object-contain"
                              />
                            )}
                          {format === 'team'
                            ? row.name
                            : (() => {
                                const pair = pairs.find((item) => item.id === row.id);
                                if (!pair) return row.name;
                                return (
                                  <span className="inline-flex flex-wrap items-center gap-1">
                                    {[pair.player_one_id, pair.player_two_id]
                                      .map((id, index) => {
                                        const player = participants.find((item) => item.id === id);
                                        const name =
                                          index === 0 ? pair.player_one_name : pair.player_two_name;
                                        const rating =
                                          index === 0
                                            ? pair.player_one_skill_level
                                            : pair.player_two_skill_level;
                                        return (
                                          <UserIdentity
                                            key={id}
                                            name={player?.display_name ?? name}
                                            skillLevel={player?.tennis_skill_level ?? rating}
                                            avatarUrl={player?.avatar_url}
                                            birthdayVisible={player?.birthday_emoji_visible}
                                            compact
                                          />
                                        );
                                      })
                                      .reduce(
                                        (acc, item, index) =>
                                          index
                                            ? [...acc, <span key={`plus-${index}`}>+</span>, item]
                                            : [item],
                                        [] as React.ReactNode[],
                                      )}
                                  </span>
                                );
                              })()}
                        </span>
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
