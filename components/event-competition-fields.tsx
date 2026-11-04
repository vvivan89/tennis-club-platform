import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/rich-text-editor';
import { PriorityBuckets } from '@/components/priority-buckets';
import {
  reorderRankingPriority,
  usesTeamStandingsPoints,
  type TournamentConfig,
} from '@/lib/tournament-config';
import type { EventFormValues } from '@/components/event-form-types';

type AvailableCompetition = {
  id: string;
  name: string;
  gender: string;
  ends_at: string | null;
  position_points: number[];
  ranking_priority: string[];
  competition_type?: string;
  tournament_config?: EventFormValues['tournament_config'] | null;
  tournament_rules_html?: string | null;
};
type ChangeValue = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => void;

export function EventCompetitionFields({
  v,
  change,
  recurring,
  availableLadders,
  ladderOptions,
  generateRulesText,
}: {
  v: EventFormValues;
  change: ChangeValue;
  recurring: boolean;
  availableLadders: AvailableCompetition[];
  ladderOptions: ReactNode;
  generateRulesText: (values: EventFormValues) => string;
}) {
  return (
    <>
      {v.event_type === 'tournament' && (
        <section className="space-y-5 rounded-xl border border-border p-5">
          <div>
            <h2 className="text-lg font-semibold">
              {v.is_league_tournament ? 'League configuration' : 'Tournament configuration'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {v.is_league_tournament
                ? 'These settings belong to the whole League and are shared by all its events.'
                : 'Tournament participants, draws, match schedules and results are managed on the event page.'}
            </p>
          </div>
          {v.is_league_tournament && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  League gender
                  <select
                    value={v.ladder_gender}
                    onChange={(e) => {
                      const gender = e.target.value as 'male' | 'female';
                      change('ladder_gender', gender);
                      change('gender_restriction', gender);
                      if (
                        v.league_existing_id &&
                        availableLadders.find((league) => league.id === v.league_existing_id)
                          ?.gender !== gender
                      )
                        change('league_existing_id', '');
                      change('tournament_config', {
                        ...v.tournament_config,
                        categories: [gender === 'male' ? 'men' : 'women'],
                      });
                    }}
                    className="block h-10 w-full rounded-md border border-input bg-background px-3"
                  >
                    <option value="male">Men&apos;s</option>
                    <option value="female">Women&apos;s</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Associate with existing league (optional)
                  <select
                    value={v.league_existing_id}
                    onChange={(e) => change('league_existing_id', e.target.value)}
                    className="block h-10 w-full rounded-md border border-input bg-background px-3"
                  >
                    <option value="">Create a new league</option>
                    {availableLadders
                      .filter(
                        (x) => x.competition_type === 'league' && x.gender === v.ladder_gender,
                      )
                      .map((league) => (
                        <option key={league.id} value={league.id}>
                          {league.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {!v.league_existing_id && (
                <div className="space-y-1">
                  <label className="block text-sm font-medium">
                    League name
                    <Input
                      value={v.ladder_name}
                      onChange={(e) => change('ladder_name', e.target.value)}
                      maxLength={160}
                      required
                    />
                  </label>
                  <span className="text-xs font-normal text-muted-foreground">
                    This is a unique name. It will aggregate results of all events associated with
                    this league
                  </span>
                </div>
              )}
              {v.league_existing_id && (
                <p className="text-sm text-muted-foreground">
                  Using existing league:{' '}
                  <strong>
                    {availableLadders.find((league) => league.id === v.league_existing_id)?.name}
                  </strong>
                  . The event title remains independent.
                </p>
              )}
            </>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {!v.is_league_tournament && (
              <fieldset className="space-y-3 rounded-md border border-border p-3">
                <legend className="text-sm font-medium">
                  {v.tournament_format === 'team'
                    ? 'Enabled team match categories'
                    : 'Enabled doubles categories and capacity'}
                </legend>
                <div className="space-y-2">
                  {(
                    [
                      ['mixed', 'Mixed doubles'],
                      ['men', "Men's doubles"],
                      ['women', "Women's doubles"],
                    ] as const
                  ).map(([key, label]) => {
                    const enabled = (v.tournament_config.categories ?? []).includes(key);
                    return (
                      <div
                        key={key}
                        className={`grid items-center gap-3 ${v.tournament_format === 'team' ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_7rem]'}`}
                      >
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) =>
                              change('tournament_config', {
                                ...v.tournament_config,
                                categories: e.target.checked
                                  ? [...new Set([...(v.tournament_config.categories ?? []), key])]
                                  : (v.tournament_config.categories ?? []).filter(
                                      (item: string) => item !== key,
                                    ),
                              })
                            }
                          />
                          {label}
                        </label>
                        {enabled && v.tournament_format !== 'team' && (
                          <Input
                            aria-label={label}
                            type="number"
                            min="1"
                            max="1000"
                            placeholder="No limit"
                            value={v.tournament_config.category_capacities?.[key] ?? ''}
                            onChange={(e) =>
                              change('tournament_config', {
                                ...v.tournament_config,
                                category_capacities: {
                                  ...v.tournament_config.category_capacities,
                                  [key]: e.target.value === '' ? null : Number(e.target.value),
                                },
                              })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.tournament_format === 'team'
                    ? 'Players register once and are assigned to a team. These categories apply to team matches and player eligibility.'
                    : 'Capacity limits count registered participant entries. Both the total limit and the category limit are enforced when registering.'}
                </p>
              </fieldset>
            )}
            {v.tournament_format === 'team' &&
              !v.is_league_tournament &&
              (v.tournament_config.categories ?? []).filter((category: string) =>
                ['mixed', 'men', 'women'].includes(category),
              ).length > 1 && (
                <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={v.tournament_config.show_overall_results === true}
                    onChange={(event) =>
                      change('tournament_config', {
                        ...v.tournament_config,
                        show_overall_results: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <span className="block font-medium">Show overall results</span>
                    <span className="block text-xs text-muted-foreground">
                      Add an Overall view that combines each team’s points and match results across
                      all enabled categories.
                    </span>
                  </span>
                </label>
              )}
            {v.tournament_format !== 'team' && (
              <fieldset className="space-y-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">Registration options</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(v.tournament_config.registration_mode ?? 'both') !== 'doubles'}
                    onChange={(e) => {
                      const mode = v.tournament_config.registration_mode ?? 'both';
                      change('tournament_config', {
                        ...v.tournament_config,
                        registration_mode: e.target.checked
                          ? mode === 'doubles'
                            ? 'both'
                            : mode
                          : mode === 'both'
                            ? 'doubles'
                            : 'doubles',
                      });
                    }}
                  />
                  <span>
                    <span className="block font-medium">Individually</span>
                    <span className="block text-xs text-muted-foreground">
                      Organizer will pair players.
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(v.tournament_config.registration_mode ?? 'both') !== 'single'}
                    onChange={(e) => {
                      const mode = v.tournament_config.registration_mode ?? 'both';
                      change('tournament_config', {
                        ...v.tournament_config,
                        registration_mode: e.target.checked
                          ? mode === 'single'
                            ? 'both'
                            : mode
                          : mode === 'both'
                            ? 'single'
                            : 'single',
                      });
                    }}
                  />
                  <span>
                    <span className="block font-medium">With partner</span>
                    <span className="block text-xs text-muted-foreground">
                      Register as a doubles pair.
                    </span>
                  </span>
                </label>
              </fieldset>
            )}
          </div>
          {!v.is_league_tournament && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Competition phases and scoring templates
              </legend>
              <div className="space-y-3">
                {(v.tournament_format === 'team'
                  ? ([
                      ['team_round_robin', 'Team round robin'],
                      ['team_knockout', 'Team knockout'],
                    ] as const)
                  : ([
                      ['preliminary_knockout', 'Preliminary knockout (requires round robin)'],
                      ['round_robin', 'Round robin'],
                      ['final_knockout', 'Final knockout'],
                    ] as const)
                ).map(([key, label]) => {
                  const enabled = !!v.tournament_config.phases?.[key];
                  return (
                    <div
                      key={key}
                      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={
                            key === 'preliminary_knockout' &&
                            !v.tournament_config.phases?.round_robin
                          }
                          onChange={(e) =>
                            change('tournament_config', {
                              ...v.tournament_config,
                              phases: {
                                ...v.tournament_config.phases,
                                [key]: e.target.checked,
                                ...(key === 'round_robin' && !e.target.checked
                                  ? { preliminary_knockout: false }
                                  : {}),
                              },
                            })
                          }
                        />
                        {label}
                      </label>
                      {enabled && (
                        <label className="block space-y-1 text-sm">
                          <span className="sr-only">{label} scoring template</span>
                          <select
                            aria-label={label}
                            value={
                              v.tournament_config.scoring_templates?.[
                                key as keyof NonNullable<TournamentConfig['scoring_templates']>
                              ] ??
                              v.tournament_config.scoring_template ??
                              'best_of_three'
                            }
                            onChange={(e) => {
                              const scoringTemplates = {
                                ...v.tournament_config.scoring_templates,
                                [key]: e.target.value,
                              };
                              const rankingPriority =
                                v.tournament_format === 'team' && key === 'team_round_robin'
                                  ? e.target.value === 'team_two_sets_bonus_third'
                                    ? [
                                        'points',
                                        ...(v.tournament_config.ranking_priority ?? []).filter(
                                          (item) => item !== 'points',
                                        ),
                                      ]
                                    : (v.tournament_config.ranking_priority ?? []).filter(
                                        (item) => item !== 'points',
                                      )
                                  : v.tournament_config.ranking_priority;
                              change('tournament_config', {
                                ...v.tournament_config,
                                scoring_templates: scoringTemplates,
                                ...(rankingPriority ? { ranking_priority: rankingPriority } : {}),
                              });
                            }}
                            className="block h-10 w-full rounded-md border border-input bg-background px-3"
                          >
                            <option value="one_set">One set</option>
                            <option value="best_of_three">Best of three sets</option>
                            {v.tournament_format === 'team' && (
                              <option value="team_two_sets_bonus_third">
                                Two sets; a 2–0 win earns 3 team points; if split 1–1, play a third
                                set for 2 points to the winner and 1 to the loser
                              </option>
                            )}
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Each phase uses its own scoring rules for score validation and generated tournament
                rules.
              </p>
            </fieldset>
          )}
          {!v.is_league_tournament &&
            (v.tournament_format === 'team'
              ? v.tournament_config.phases?.team_round_robin
              : v.tournament_config.phases?.round_robin) && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1 text-sm">
                  Group count
                  <Input
                    type="number"
                    min="1"
                    max="32"
                    value={v.tournament_config.group_count ?? 2}
                    onChange={(e) =>
                      change('tournament_config', {
                        ...v.tournament_config,
                        group_count: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm">
                  Teams per group
                  <Input
                    type="number"
                    min="2"
                    max="32"
                    value={v.tournament_config.teams_per_group ?? 4}
                    onChange={(e) =>
                      change('tournament_config', {
                        ...v.tournament_config,
                        teams_per_group: Math.max(2, Number(e.target.value) || 2),
                      })
                    }
                  />
                </label>
                {(v.tournament_format === 'team'
                  ? v.tournament_config.phases?.team_knockout
                  : v.tournament_config.phases?.final_knockout) && (
                  <label className="space-y-1 text-sm">
                    Teams promoted from each group
                    <Input
                      type="number"
                      min="1"
                      max={Math.max(1, Number(v.tournament_config.teams_per_group ?? 4))}
                      value={v.tournament_config.promoted_teams_per_group ?? 2}
                      onChange={(e) =>
                        change('tournament_config', {
                          ...v.tournament_config,
                          promoted_teams_per_group: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                    />
                    <span className="block text-xs text-muted-foreground">
                      The highest-ranked teams from each group advance to the knockout stage.
                    </span>
                  </label>
                )}
              </div>
            )}
          {(v.tournament_format === 'team'
            ? v.tournament_config.phases?.team_round_robin
            : v.is_league_tournament || v.tournament_config.phases?.round_robin) && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Group ranking priority (drag to reorder; highest priority first)
              </legend>
              <p className="text-xs text-muted-foreground">
                Drag criteria into the order you want. You can also use the move buttons.
              </p>
              {(() => {
                const pointsEnabled =
                  v.tournament_format === 'team' && usesTeamStandingsPoints(v.tournament_config);
                const options = [
                  ...(pointsEnabled ? ([['points', 'Points']] as const) : []),
                  ['matches_won', 'Matches won'],
                  ['sets_won', 'Sets won'],
                  ['games_won', 'Games won'],
                  ['set_difference', 'Set difference'],
                  ['game_difference', 'Game difference'],
                  ['head_to_head', 'Head-to-head'],
                ] as const;
                const optionKeys: string[] = options.map(([key]) => key);
                const defaults: string[] = pointsEnabled
                  ? ['points', 'matches_won', 'sets_won', 'games_won']
                  : ['matches_won', 'sets_won', 'games_won'];
                const saved: string[] = (v.tournament_config.ranking_priority ?? defaults).filter(
                  (key) => optionKeys.includes(key as (typeof optionKeys)[number]),
                );
                const withoutPoints: string[] = [
                  ...new Set<string>(saved.filter((key) => key !== 'points')),
                ];
                const priority: string[] = pointsEnabled
                  ? ['points', ...withoutPoints]
                  : withoutPoints;
                const reorder = (source: string, targetIndex: number) => {
                  const next = reorderRankingPriority(priority, source, targetIndex);
                  const ordered = pointsEnabled
                    ? ['points', ...next.filter((key) => key !== 'points')]
                    : next;
                  change('tournament_config', {
                    ...v.tournament_config,
                    ranking_priority: ordered,
                  });
                };
                const updatePriority = (next: string[]) => {
                  const ordered = pointsEnabled
                    ? ['points', ...next.filter((key) => key !== 'points')]
                    : next;
                  change('tournament_config', {
                    ...v.tournament_config,
                    ranking_priority: ordered,
                  });
                };
                const dropAvailableItem = (source: string, target: string) => {
                  if (!source || source === target) return;
                  const next = [...priority];
                  const sourceIndex = next.indexOf(source);
                  if (sourceIndex < 0) return;
                  next.splice(sourceIndex, 1);
                  const targetIndex = next.indexOf(target);
                  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
                  updatePriority(next);
                };
                return (
                  <PriorityBuckets
                    options={options}
                    priority={priority}
                    selectedAriaLabel="Group ranking priorities"
                    priorityWidth="w-24"
                    lockedKeys={pointsEnabled ? ['points'] : []}
                    onDropSelectedPanel={(source) => {
                      if (source && !priority.includes(source))
                        updatePriority([...priority.filter((key) => key !== 'points'), source]);
                    }}
                    onDropSelectedItem={(source, target, index) => {
                      if (source !== target) reorder(source, index);
                    }}
                    onDropAvailablePanel={(source) => {
                      if (source && !(pointsEnabled && source === 'points'))
                        updatePriority(priority.filter((key) => key !== source));
                    }}
                    onDropAvailableItem={dropAvailableItem}
                    onAdd={(key) => updatePriority([...priority, key])}
                    onRemove={(key) => updatePriority(priority.filter((item) => item !== key))}
                    onReorder={reorder}
                  />
                );
              })()}
            </fieldset>
          )}
          {!v.is_league_tournament && (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="font-medium">Tournament rules</label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => change('tournament_rules_html', generateRulesText(v))}
                >
                  Generate rules text
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Add text version of the rules here.</p>
              <RichTextEditor
                value={v.tournament_rules_html}
                onChange={(html) => change('tournament_rules_html', html)}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.allow_non_member_registration}
              onChange={(e) => change('allow_non_member_registration', e.target.checked)}
            />
            Allow non-member registration without creating accounts
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.tournament_details_public}
              onChange={(e) => change('tournament_details_public', e.target.checked)}
            />
            Publish tournament participants, teams, schedule, and results publicly
          </label>
          {v.event_type === 'tournament' && recurring && !v.is_league_tournament && (
            <p role="alert" className="text-sm text-destructive">
              Tournament events cannot be recurring. Turn off repeat-event to continue.
            </p>
          )}
        </section>
      )}
      {v.event_type === 'social_doubles_ladder' && (
        <section className="sm:col-span-2 space-y-4 rounded-lg border border-border p-4">
          <h3 className="font-semibold">Social Doubles Ladder configuration</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Ladder gender
              <select
                value={v.ladder_gender}
                onChange={(e) => {
                  const gender = e.target.value as 'male' | 'female';
                  change('ladder_gender', gender);
                  change('gender_restriction', gender);
                }}
                className="block h-10 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="male">Men&apos;s</option>
                <option value="female">Women&apos;s</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Associate with existing ladder (optional)
              <select
                value={v.ladder_existing_id}
                onChange={(e) => change('ladder_existing_id', e.target.value)}
                className="block h-10 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">Create a new ladder</option>
                {ladderOptions}
              </select>
            </label>
          </div>
          {!v.ladder_existing_id && (
            <div className="space-y-1">
              <label className="block text-sm font-medium">
                Ladder name
                <Input
                  value={v.ladder_name}
                  onChange={(e) => change('ladder_name', e.target.value)}
                  maxLength={160}
                  required
                />
              </label>
              <span className="text-xs font-normal text-muted-foreground">
                This is a unique name. It will aggregate results of all events associated with this
                ladder
              </span>
            </div>
          )}
          {v.ladder_existing_id && (
            <p className="text-sm text-muted-foreground">
              Using existing ladder:{' '}
              <strong>
                {availableLadders.find((ladder) => ladder.id === v.ladder_existing_id)?.name}
              </strong>
              . The event title remains independent.
            </p>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Position-based points (1st through 4th)</p>
            <div className="grid grid-cols-4 gap-2">
              {v.ladder_points.map((points, index) => (
                <label key={index} className="text-xs text-muted-foreground">
                  {['1st', '2nd', '3rd', '4th'][index]}
                  <Input
                    type="number"
                    value={points}
                    onChange={(e) => {
                      const next = [...v.ladder_points] as [number, number, number, number];
                      next[index] = Number(e.target.value);
                      change('ladder_points', next);
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Ranking criteria (drag to reorder; highest priority first)
            </legend>
            <p className="text-xs text-muted-foreground">
              Drag criteria between the two boxes to choose which metrics are used. Reorder selected
              criteria to set their priority. You can also use the move buttons.
            </p>
            {(() => {
              const options = [
                ['sets_won', 'Sets won'],
                ['games_won', 'Games won'],
                ['games_difference', 'Games difference'],
                ['sets_difference', 'Sets difference'],
              ] as const;
              const optionKeys: string[] = options.map(([key]) => key);
              const priority = [
                ...new Set(
                  v.ladder_ranking_priority.filter((key) =>
                    optionKeys.includes(key as (typeof optionKeys)[number]),
                  ),
                ),
              ];
              const changePriority = (next: string[]) => change('ladder_ranking_priority', next);
              const reorder = (source: string, targetIndex: number) => {
                const next = [...priority];
                const sourceIndex = next.indexOf(source);
                if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= next.length) return;
                next.splice(sourceIndex, 1);
                next.splice(Math.min(targetIndex, next.length), 0, source);
                changePriority(next);
              };
              const moveToAvailable = (key: string) =>
                changePriority(priority.filter((item) => item !== key));
              const moveToSelected = (key: string) => {
                if (!priority.includes(key)) changePriority([...priority, key]);
              };
              return (
                <PriorityBuckets
                  options={options}
                  priority={priority}
                  selectedAriaLabel="Ladder ranking priorities"
                  availableAriaLabel="Available ladder ranking criteria"
                  priorityWidth="w-20"
                  dataAttribute="ladder-ranking"
                  emptyPriorityMessage="No criteria selected. Add at least one criterion."
                  stopRowDropPropagation
                  onDropSelectedPanel={(source) => {
                    if (source && optionKeys.includes(source) && !priority.includes(source))
                      moveToSelected(source);
                  }}
                  onDropSelectedItem={(source, targetKey, index) => {
                    if (source && source !== targetKey && priority.includes(source))
                      reorder(source, index);
                    else if (source && optionKeys.includes(source)) moveToSelected(source);
                  }}
                  onDropAvailablePanel={(source) => {
                    if (source && priority.includes(source)) moveToAvailable(source);
                  }}
                  onDropAvailableItem={(source) => {
                    if (source && priority.includes(source)) moveToAvailable(source);
                    else if (source && optionKeys.includes(source)) moveToSelected(source);
                  }}
                  onAdd={moveToSelected}
                  onRemove={moveToAvailable}
                  onReorder={reorder}
                />
              );
            })()}
            <p className="text-xs text-muted-foreground">
              Select at least one metric. If all selected metrics are tied, all players receive same
              points.
            </p>
          </fieldset>
          <label className="block space-y-1 text-sm font-medium">
            Previous ladder carryover
            <select
              value={v.ladder_carryover}
              onChange={(e) =>
                change('ladder_carryover', e.target.value as EventFormValues['ladder_carryover'])
              }
              className="block h-10 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="none">Start from zero</option>
              <option value="position">Carry over initial positions only</option>
              <option value="full">Carry over positions and points</option>
            </select>
          </label>
          {v.ladder_carryover !== 'none' && (
            <label className="block space-y-1 text-sm font-medium">
              Previous ladder
              <select
                value={v.ladder_previous_id}
                onChange={(e) => change('ladder_previous_id', e.target.value)}
                required
                className="block h-10 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">Select previous ladder</option>
                {ladderOptions}
              </select>
            </label>
          )}
        </section>
      )}
    </>
  );
}
