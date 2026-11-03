import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Sparkles, Trophy } from 'lucide-react';
import type { TournamentConfig } from '@/lib/tournament-config';
import { categoryLabel } from '@/components/tournament-public-view-format';

export type TournamentPublicTab =
  'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit';

export function TournamentPublicViewControls({
  resultsOnly,
  winnerSummaries,
  rankingsControl,
  hasRules,
  leagueTournament,
  hasAdminContent,
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
  rankingsControl?: ReactNode;
  hasRules: boolean;
  leagueTournament: boolean;
  hasAdminContent: boolean;
  tab: TournamentPublicTab;
  setTab: Dispatch<SetStateAction<TournamentPublicTab>>;
  activeCategory: string;
  setActiveCategory: (category: string) => void;
  format: string | null;
  config: TournamentConfig | null;
  onAssignCourts: () => void;
}) {
  return (
    <>
      {!resultsOnly && winnerSummaries.length > 0 && (
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
                  {summary.category === 'men'
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
                  ...(hasAdminContent
                    ? [
                        ['participants', 'Participants'] as [TournamentPublicTab, string],
                        ...(!leagueTournament
                          ? ([
                              ['matches', 'Matches'],
                              ['audit', 'Audit log'],
                            ] as Array<[TournamentPublicTab, string]>)
                          : []),
                      ]
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
          {format !== 'team' &&
            (config?.categories ?? ['mixed', 'men', 'women']).filter((category) =>
              ['mixed', 'men', 'women'].includes(category),
            ).length > 1 && (
              <div
                className="order-2 ml-auto inline-flex flex-wrap rounded-md border border-border p-1"
                role="group"
                aria-label="Tournament category"
              >
                {(config?.categories ?? ['mixed', 'men', 'women'])
                  .filter((category) => ['mixed', 'men', 'women'].includes(category))
                  .map((category) => (
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
