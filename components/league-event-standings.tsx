'use client';

import { useState } from 'react';
import { Triangle } from 'lucide-react';
import { UserIdentity } from '@/components/user-identity';
import type { Participant } from '@/components/tournament-public-view-types';

type StandingRow = Record<string, unknown>;

export function LeagueEventStandings({
  before,
  after,
  hasResults,
  currentUserId = null,
  participants = [],
}: {
  before: StandingRow[];
  after: StandingRow[];
  hasResults: boolean;
  currentUserId?: string | null;
  participants?: Participant[];
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
          <thead className="bg-muted">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium">Rank</th>
              <th className="px-4 py-3 text-left font-medium">Team</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Played</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Wins</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Points</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Sets</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Games</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, index) => {
              const one = participants.find((player) => player.user_id === row.player_one_id);
              const two = participants.find((player) => player.user_id === row.player_two_id);
              const isMe =
                row.player_one_id === currentUserId || row.player_two_id === currentUserId;
              const oldPosition = beforePositions.get(String(row.team_id));
              const hasPlayerNames = Boolean(
                one || two || row.player_one_name || row.player_two_name,
              );
              const teamLabel = hasPlayerNames ? null : String(row.team_name ?? '');
              const delta =
                period === 'after' && oldPosition !== undefined
                  ? oldPosition - Number(row.position ?? index + 1)
                  : 0;
              const movement = `${delta > 0 ? 'Moved up' : 'Moved down'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'place' : 'places'}`;
              return (
                <tr
                  key={String(row.team_id ?? index)}
                  className={`border-t border-border ${isMe ? 'bg-primary/10 font-medium' : ''}`}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    {String(row.position ?? index + 1)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {!hasPlayerNames ? (
                        teamLabel
                      ) : (
                        <>
                          <UserIdentity
                            name={one?.display_name ?? String(row.player_one_name ?? 'Player')}
                            skillLevel={one?.tennis_skill_level ?? null}
                            avatarUrl={one?.avatar_url}
                            birthdayVisible={one?.birthday_emoji_visible}
                            compact
                          />
                          {row.player_one_id === currentUserId && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                              You
                            </span>
                          )}
                          <span aria-hidden="true">+</span>
                          <UserIdentity
                            name={two?.display_name ?? String(row.player_two_name ?? 'Player')}
                            skillLevel={two?.tennis_skill_level ?? null}
                            avatarUrl={two?.avatar_url}
                            birthdayVisible={two?.birthday_emoji_visible}
                            compact
                          />
                          {row.player_two_id === currentUserId && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                              You
                            </span>
                          )}
                        </>
                      )}
                    </div>
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
                  <td className="px-4 py-3 text-right">{String(row.matches_played ?? 0)}</td>
                  <td className="px-4 py-3 text-right">{String(row.wins ?? 0)}</td>
                  <td className="px-4 py-3 text-right">{String(row.points ?? 0)}</td>
                  <td className="px-4 py-3 text-right">
                    {String(row.sets_won ?? 0)}–{String(row.sets_lost ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
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
