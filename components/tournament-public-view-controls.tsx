import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Sparkles, Trophy } from 'lucide-react';
import type { TournamentConfig } from '@/lib/tournament-config';
import { categoryLabel } from '@/components/tournament-public-view-format';

export type TournamentPublicTab =
  'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit';

export function TournamentPublicViewControls({
  resultsOnly,
  winnerSummaries,
  adminWinnerPreview,
  isManager,
  allScheduledMatchesPlayed,
  winnersAnnounced,
  announcementBusy,
  onToggleWinnersAnnouncement,
  rankingsControl,
  hasRules,
  leagueTournament,
  hasAdminContent,
  isTeamCaptain,
  captainOnlyView,
  tab,
  setTab,
  activeCategory,
  setActiveCategory,
  format,
  config,
  onAssignCourts,
}: {
  resultsOnly: boolean;
  winnerSummaries: Array<{ category: string; winners: string[] }>;
  adminWinnerPreview: Array<{ category: string; winners: string[] }>;
  isManager: boolean;
  allScheduledMatchesPlayed: boolean;
  winnersAnnounced: boolean;
  announcementBusy: boolean;
  onToggleWinnersAnnouncement: () => void;
  rankingsControl?: ReactNode;
  hasRules: boolean;
  leagueTournament: boolean;
  hasAdminContent: boolean;
  isTeamCaptain: boolean;
  captainOnlyView: boolean;
  tab: TournamentPublicTab;
  setTab: Dispatch<SetStateAction<TournamentPublicTab>>;
  activeCategory: string;
  setActiveCategory: (category: string) => void;
  format: string | null;
  config: TournamentConfig | null;
  onAssignCourts: () => void;
}) {
  const enabledCategories = (config?.categories ?? ['mixed', 'men', 'women']).filter((category) =>
    ['mixed', 'men', 'women'].includes(category),
  );
  const categoryOptions =
    format === 'team' && enabledCategories.length > 1 && config?.show_overall_results
      ? [...enabledCategories, 'overall']
      : enabledCategories;
  const winnerCategoryLabel = (category: string) => {
    if (format !== 'team') return categoryLabel(category);
    if (category === 'overall') return 'Overall team standings';
    const gender = category === 'men' ? "Men's" : category === 'women' ? "Women's" : 'Mixed';
    return `${gender} teams`;
  };
  const reviewWinners = winnersAnnounced ? winnerSummaries : adminWinnerPreview;
  return (
    <>
      {!resultsOnly && isManager && (allScheduledMatchesPlayed || winnersAnnounced) && (
        <section
          aria-label="Tournament winner announcement"
          className="space-y-4 rounded-2xl border-2 border-amber-500 bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-100 p-5 shadow-lg ring-2 ring-amber-400/40 dark:border-amber-700 dark:from-amber-950 dark:via-yellow-950 dark:to-orange-950 dark:ring-amber-800/60"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-amber-950 dark:text-amber-100">
                {winnersAnnounced
                  ? 'Tournament winners announced'
                  : 'Tournament results are complete'}
              </h2>
              <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200">
                {allScheduledMatchesPlayed
                  ? 'Results of all matches are recorded.'
                  : 'Winners have been announced.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleWinnersAnnouncement}
              disabled={announcementBusy || (!allScheduledMatchesPlayed && !winnersAnnounced)}
              className="h-10 shrink-0 rounded-md bg-amber-950 px-4 text-sm font-semibold text-white shadow hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-amber-200"
            >
              {announcementBusy
                ? 'Saving…'
                : winnersAnnounced
                  ? 'Unannounce winners'
                  : 'Announce winners'}
            </button>
          </div>
          {!winnersAnnounced && reviewWinners.length > 0 && (
            <p className="border-t border-amber-500/40 pt-4 text-sm font-medium text-amber-900 dark:text-amber-200">
              Review the winners below. They will appear publicly after you announce them.
            </p>
          )}
          {reviewWinners.length > 0 && (
            <ul
              aria-label={winnersAnnounced ? 'Announced winners' : 'Winner preview'}
              className="grid gap-3 border-t border-amber-500/40 pt-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {reviewWinners.map((summary) => (
                <li
                  key={summary.category}
                  className="rounded-lg border border-amber-500/40 bg-white/70 p-3 shadow-sm dark:border-amber-700 dark:bg-black/20"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    {winnerCategoryLabel(summary.category)}
                  </p>
                  <p className="mt-1 font-semibold text-amber-950 dark:text-amber-50">
                    {summary.winners.join(' / ')}
                  </p>
                  {summary.winners.length > 1 && (
                    <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-300">
                      Tie
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!resultsOnly && !isManager && winnerSummaries.length > 0 && (
        <section aria-label="Tournament winners">
          <div className="grid auto-cols-max grid-flow-col gap-4 overflow-x-auto pb-2">
            {winnerSummaries.map((summary) => (
              <div
                key={summary.category}
                className="min-w-52 rounded-xl border border-amber-300/80 bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-100 p-4 text-center shadow-md ring-1 ring-amber-200/60 dark:border-amber-800 dark:from-amber-950/70 dark:via-yellow-950/45 dark:to-orange-950/70 dark:ring-amber-900/70"
              >
                <div
                  className="mb-3 flex items-center justify-center gap-2 text-amber-600"
                  aria-hidden="true"
                >
                  <Sparkles className="h-4 w-4" />
                  <Trophy className="h-7 w-7 drop-shadow-sm" />
                  <Sparkles className="h-4 w-4" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {format === 'team'
                    ? `${categoryLabel(summary.category)} Team Winners`
                    : summary.category === 'men'
                      ? "Men's Doubles Winners"
                      : summary.category === 'women'
                        ? "Women's Doubles Winners"
                        : summary.category === 'mixed'
                          ? 'Mixed Doubles Winners'
                          : 'Team Tournament Winners'}
                </p>
                <p className="mt-2 font-semibold">{summary.winners.join(' / ')}</p>
                {summary.winners.length > 1 && (
                  <span className="mt-1 inline-block text-xs font-medium text-amber-700 dark:text-amber-400">
                    Tie
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {(!resultsOnly || rankingsControl) && (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {!resultsOnly && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tournament details">
              {(
                [
                  ['overview', 'Overview'],
                  ...(hasRules
                    ? ([['rules', 'Rules']] as Array<[TournamentPublicTab, string]>)
                    : []),
                  [
                    'competition',
                    leagueTournament ? 'Schedule & Results' : 'Groups, Schedule & Results',
                  ],
                  ...(hasAdminContent && !captainOnlyView
                    ? [
                        ['participants', 'Participants'] as [TournamentPublicTab, string],
                        ...(!leagueTournament
                          ? ([
                              ['matches', 'Matches'],
                              ['audit', 'Audit log'],
                            ] as Array<[TournamentPublicTab, string]>)
                          : []),
                      ]
                    : isTeamCaptain && !leagueTournament
                      ? ([['matches', 'Matches']] as Array<[TournamentPublicTab, string]>)
                      : []),
                ] as Array<[TournamentPublicTab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    setTab(key);
                    if (['participants', 'matches', 'audit'].includes(key)) {
                      window.setTimeout(() => {
                        window.dispatchEvent(
                          new CustomEvent('pctc-tournament-category-change', {
                            detail: { category: activeCategory },
                          }),
                        );
                        window.dispatchEvent(
                          new CustomEvent('pctc-tournament-tab-change', { detail: { tab: key } }),
                        );
                      }, 0);
                    }
                  }}
                  className={`rounded-md border px-3 py-2 text-sm ${tab === key ? 'border-primary bg-primary/10 font-semibold' : 'border-border'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {rankingsControl && <div className="order-1 shrink-0">{rankingsControl}</div>}
          {categoryOptions.length > 1 && (
            <div
              className="order-2 ml-auto inline-flex flex-wrap rounded-md border border-border p-1"
              role="group"
              aria-label="Tournament category"
            >
              {categoryOptions.map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={activeCategory === category}
                  onClick={() => {
                    setActiveCategory(category);
                    window.dispatchEvent(
                      new CustomEvent('pctc-tournament-category-change', {
                        detail: { category },
                      }),
                    );
                  }}
                  className={`rounded px-3 py-2 text-sm ${activeCategory === category ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-secondary'}`}
                >
                  {categoryLabel(category)}
                </button>
              ))}
            </div>
          )}
          {leagueTournament && hasAdminContent && (
            <button
              type="button"
              onClick={onAssignCourts}
              className="ml-auto h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Assign courts
            </button>
          )}
        </div>
      )}
    </>
  );
}
