'use client';

import { useState } from 'react';
import { Triangle } from 'lucide-react';

type StandingRow = Record<string, unknown>;

export function LeagueEventStandings({
  before,
  after,
  hasResults,
}: {
  before: StandingRow[];
  after: StandingRow[];
  hasResults: boolean;
}) {
  const [period, setPeriod] = useState<'before' | 'after'>('before');
  const standings = period === 'after' ? after : before;
  const beforePositions = new Map(before.map((row) => [String(row.team_id), Number(row.position)]));

  return (
    <section
      className="overflow-x-auto rounded-lg border border-border p-4"
      aria-label="League standings"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">League standings</h2>
        <div
          className="inline-flex rounded-md border border-border p-1"
          role="group"
          aria-label="Standings period"
        >
          <button
            type="button"
            aria-pressed={period === 'before'}
            onClick={() => setPeriod('before')}
            className={`rounded px-3 py-1.5 text-sm ${period === 'before' ? 'bg-primary text-primary-foreground' : ''}`}
          >
            Before this event
          </button>
          <button
            type="button"
            aria-pressed={period === 'after'}
            onClick={() => setPeriod('after')}
            className={`rounded px-3 py-1.5 text-sm ${period === 'after' ? 'bg-primary text-primary-foreground' : ''}`}
          >
            After this event
          </button>
        </div>
      </div>
      {period === 'after' && !hasResults ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No results are available for this event yet.
        </p>
      ) : !standings.length ? (
        <p className="mt-4 text-sm text-muted-foreground">No records yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Rank</th>
              <th className="p-2">Team</th>
              <th className="p-2">Played</th>
              <th className="p-2">Wins</th>
              <th className="p-2">Points</th>
              <th className="p-2">Sets</th>
              <th className="p-2">Games</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, index) => {
              const oldPosition = beforePositions.get(String(row.team_id));
              const delta =
                period === 'after' && oldPosition !== undefined
                  ? oldPosition - Number(row.position ?? index + 1)
                  : 0;
              const movement = `${delta > 0 ? 'Moved up' : 'Moved down'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'place' : 'places'}`;
              return (
                <tr key={String(row.team_id ?? index)} className="border-t border-border">
                  <td className="p-2">{String(row.position ?? index + 1)}</td>
                  <td className="p-2">
                    {String(row.team_name ?? '')}
                    {delta !== 0 && (
                      <span
                        aria-label={movement}
                        title={movement}
                        className={`ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${delta > 0 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'}`}
                      >
                        <Triangle
                          aria-hidden="true"
                          size={11}
                          fill="currentColor"
                          className={delta < 0 ? 'rotate-180' : undefined}
                        />
                        {Math.abs(delta)}
                      </span>
                    )}
                  </td>
                  <td className="p-2">{String(row.matches_played ?? 0)}</td>
                  <td className="p-2">{String(row.wins ?? 0)}</td>
                  <td className="p-2">{String(row.points ?? 0)}</td>
                  <td className="p-2">
                    {String(row.sets_won ?? 0)}–{String(row.sets_lost ?? 0)}
                  </td>
                  <td className="p-2">
                    {String(row.games_won ?? 0)}–{String(row.games_lost ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
