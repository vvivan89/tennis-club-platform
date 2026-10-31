'use client';
import { useMemo, useState } from 'react';
import type { RankingPlayer } from '@/lib/player-rankings';
import { medal } from '@/lib/player-rankings';
import type { ReactNode } from 'react';
type SortKey = 'points' | 'gamesPercentage' | 'gamesWon' | 'setsWon' | 'skillRating' | 'name';
type GenderFilter = 'all' | 'male' | 'female';

const formatPositionPoints = (value: number) => {
  const signed = `${value > 0 ? '+' : ''}${value}`;
  return `${signed} ${Math.abs(value) === 1 ? 'point' : 'points'}`;
};

export function RankingsTable({
  players,
  currentUserId,
  ladderPoints,
  ladderRankingPriority,
  ladderSeedOrder,
  ladderPositionPoints,
  competitionSelector,
}: {
  players: RankingPlayer[];
  currentUserId: string;
  ladderPoints?: Map<string, number>;
  ladderRankingPriority?: string[];
  ladderSeedOrder?: Map<string, number>;
  ladderPositionPoints?: number[];
  competitionSelector?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({
    key: ladderPoints ? 'points' : 'gamesPercentage',
    asc: false,
  });
  const compareLadder = (a: RankingPlayer, b: RankingPlayer) => {
    const points = (ladderPoints?.get(b.id) ?? 0) - (ladderPoints?.get(a.id) ?? 0);
    if (points) return points;
    if (a.gamesPlayed === 0 && b.gamesPlayed === 0) {
      const seedDelta =
        (ladderSeedOrder?.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (ladderSeedOrder?.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      if (seedDelta) return seedDelta;
    }
    for (const metric of ladderRankingPriority ?? []) {
      const value = (p: RankingPlayer) =>
        metric === 'sets_won'
          ? p.setsWon
          : metric === 'games_won'
            ? p.gamesWon
            : metric === 'games_difference'
              ? p.gamesWon - p.gamesLost
              : metric === 'sets_difference'
                ? p.setsWon - p.setsLost
                : 0;
      const delta = value(b) - value(a);
      if (delta) return delta;
    }
    return a.name.localeCompare(b.name);
  };
  const [gender, setGender] = useState<GenderFilter>('all');
  const filteredPlayers = useMemo(
    () =>
      players.filter(
        (p) =>
          (gender === 'all' || p.gender === gender) && (!ladderPoints || ladderPoints.has(p.id)),
      ),
    [players, gender, ladderPoints],
  );
  const ranked = useMemo(
    () =>
      [...filteredPlayers]
        .filter((p) => (ladderPoints ? true : p.gamesPlayed > 0))
        .sort(
          (a, b) =>
            (ladderPoints ? compareLadder(a, b) : 0) ||
            b.gamesPercentage - a.gamesPercentage ||
            b.gamesWon - a.gamesWon ||
            b.gamesPlayed - a.gamesPlayed ||
            a.name.localeCompare(b.name),
        ),
    [filteredPlayers, ladderPoints, ladderRankingPriority, ladderSeedOrder],
  );
  const unranked = useMemo(
    () =>
      ladderPoints
        ? []
        : [...filteredPlayers]
            .filter((p) => p.gamesPlayed === 0)
            .sort((a, b) => a.name.localeCompare(b.name)),
    [filteredPlayers],
  );
  const positions = new Map<string, number>(ranked.map((p, i): [string, number] => [p.id, i + 1]));
  const rows = useMemo(
    () =>
      [...ranked].sort((a, b) => {
        let result = 0;
        if (sort.key === 'points' && ladderPoints) result = compareLadder(a, b);
        else if (sort.key === 'name') result = a.name.localeCompare(b.name);
        else if (sort.key === 'skillRating')
          result = (b.skillRating ?? -1) - (a.skillRating ?? -1) || a.name.localeCompare(b.name);
        else if (sort.key === 'setsWon')
          result = b.setsWon - a.setsWon || a.name.localeCompare(b.name);
        else if (sort.key === 'gamesWon')
          result = b.gamesWon - a.gamesWon || a.name.localeCompare(b.name);
        else
          result =
            b.gamesPercentage - a.gamesPercentage ||
            b.gamesWon - a.gamesWon ||
            b.gamesPlayed - a.gamesPlayed ||
            a.name.localeCompare(b.name);
        return sort.key === 'name' ? (sort.asc ? result : -result) : sort.asc ? -result : result;
      }),
    [ranked, sort, ladderPoints, ladderRankingPriority, ladderSeedOrder],
  );
  const header = (key: SortKey, label: string, right = false) => (
    <th
      key={key}
      className={`whitespace-nowrap px-4 py-3 font-medium ${right ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() =>
          setSort((current) => ({ key, asc: current.key === key ? !current.asc : key === 'name' }))
        }
        className="inline-flex items-center gap-1 hover:underline"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.asc ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
  const tableHead = (
    <thead className="bg-muted">
      <tr>
        <th className="px-4 py-3 text-left font-medium">Rank</th>
        {header('name', 'Player')}
        {ladderPoints && (
          <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
            <button
              type="button"
              onClick={() =>
                setSort((current) => ({
                  key: 'points',
                  asc: current.key === 'points' ? !current.asc : false,
                }))
              }
            >
              Points {sort.key === 'points' ? (sort.asc ? '↑' : '↓') : ''}
            </button>
          </th>
        )}
        {header('gamesPercentage', 'Games won %', true)}
        {header('gamesWon', 'Games', true)}
        {header('setsWon', 'Sets', true)}
        {header('skillRating', 'Skill rating', true)}
      </tr>
    </thead>
  );
  const renderPlayer = (player: RankingPlayer, rank?: number) => {
    const isMe = player.id === currentUserId;
    return (
      <tr
        key={player.id}
        className={`border-t border-border ${isMe ? 'bg-primary/10 font-medium' : ''} ${rank === undefined ? 'text-muted-foreground' : ''}`}
      >
        <td className="whitespace-nowrap px-4 py-3">
          {rank ? (
            <span className="inline-flex min-w-8 items-center gap-1.5">
              {medal(rank) && (
                <span aria-label={`Rank ${rank}`} title={`Rank ${rank}`} className="text-base">
                  {medal(rank)}
                </span>
              )}
              <span>{rank}</span>
            </span>
          ) : (
            '—'
          )}
        </td>
        <td className="px-4 py-3">
          {player.name}
          {isMe && (
            <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
              You
            </span>
          )}
        </td>
        {ladderPoints && (
          <td className="px-4 py-3 text-right">
            {rank === undefined ? '—' : (ladderPoints.get(player.id) ?? 0)}
          </td>
        )}
        <td className="px-4 py-3 text-right">
          {rank === undefined ? '—' : `${player.gamesPercentage.toFixed(1)}%`}
        </td>
        <td className="px-4 py-3 text-right">
          {rank === undefined ? '—' : `${player.gamesWon}–${player.gamesLost}`}
        </td>
        <td className="px-4 py-3 text-right">
          {rank === undefined ? '—' : `${player.setsWon}–${player.setsLost}`}
        </td>
        <td className="px-4 py-3 text-right">
          {player.skillRating === null ? '—' : player.skillRating.toFixed(1)}
        </td>
      </tr>
    );
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {competitionSelector}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="text-sm text-muted-foreground">Show rankings for</p>
          <div
            role="group"
            aria-label="Player gender"
            className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
          >
            {(
              [
                { value: 'all', label: 'All players' },
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={gender === option.value}
                onClick={() => setGender(option.value)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${gender === option.value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          {tableHead}
          <tbody>
            {rows.map((player) => renderPlayer(player, positions.get(player.id)))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={ladderPoints ? 7 : 6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No players found for this selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {unranked.length > 0 && (
        <details className="mt-4 overflow-hidden rounded-lg border border-border">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50">
            <span className="mr-2 inline-block transition-transform details-chevron">›</span>Players
            without a rank <span className="ml-1 font-normal">({unranked.length})</span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-left text-sm">
              {tableHead}
              <tbody>{unranked.map((player) => renderPlayer(player))}</tbody>
            </table>
          </div>
        </details>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {ladderPoints
          ? `Ladder ranks use points: 1st ${formatPositionPoints(ladderPositionPoints?.[0] ?? 2)}, 2nd ${formatPositionPoints(ladderPositionPoints?.[1] ?? 1)}, 3rd ${formatPositionPoints(ladderPositionPoints?.[2] ?? -1)}, 4th ${formatPositionPoints(ladderPositionPoints?.[3] ?? -2)}.`
          : 'Rank numbers reflect games-won percentage. Players without recorded results are not ranked.'}
      </p>
    </div>
  );
}
