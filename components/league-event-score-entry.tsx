'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { Match, Pair } from '@/components/tournament-public-view-types';

type ScoreDrafts = Record<string, { one: string; two: string }>;

export function LeagueEventScoreEntry({
  matches,
  pairs,
  currentUserId,
  canManageLeagueScores,
  leagueEventStarted,
  leagueScoresOpen,
  leagueScoreMatchId,
  setLeagueScoreMatchId,
  leagueScoreTeamSide,
  setLeagueScoreTeamSide,
  leagueScoreDrafts,
  setLeagueScoreDrafts,
  savingLeagueScore,
  saveLeagueScore,
  isOwnPair,
}: {
  matches: Match[];
  pairs: Pair[];
  currentUserId: string | null;
  canManageLeagueScores: boolean;
  leagueEventStarted: boolean;
  leagueScoresOpen: boolean;
  leagueScoreMatchId: string;
  setLeagueScoreMatchId: (value: string) => void;
  leagueScoreTeamSide: '1' | '2';
  setLeagueScoreTeamSide: (value: '1' | '2') => void;
  leagueScoreDrafts: ScoreDrafts;
  setLeagueScoreDrafts: Dispatch<SetStateAction<ScoreDrafts>>;
  savingLeagueScore: string | null;
  saveLeagueScore: (match: Match) => void;
  isOwnPair: (pairId: string | null | undefined) => boolean;
}) {
  const leagueMatches = matches.filter(
    (match) => match.phase === 'round_robin' && match.pair_one_id && match.pair_two_id,
  );
  const scoreableMatches = leagueMatches.filter(
    (match) =>
      match.status !== 'cancelled' &&
      (canManageLeagueScores || isOwnPair(match.pair_one_id) || isOwnPair(match.pair_two_id)),
  );
  const selectedMatch = leagueMatches.find((match) => match.id === leagueScoreMatchId);
  const selectedDraft = selectedMatch
    ? (leagueScoreDrafts[selectedMatch.id] ?? { one: '', two: '' })
    : { one: '', two: '' };
  const pairName = (pairId: string | null) => {
    const pair = pairs.find((item) => item.id === pairId);
    return pair ? `${pair.player_one_name} / ${pair.player_two_name}` : 'League team';
  };
  const matchTimeLabel = (match: Match) =>
    `Court ${match.court_number ?? 'TBD'} · Sub-session ${match.round_number}`;

  return (
    <section className="order-5" aria-label="League match scores">
      <h3 className="text-xl font-semibold">Scores</h3>
      <div className="mt-3 space-y-2">
        {leagueMatches
          .filter((match) => match.status === 'completed')
          .map((match) => (
            <div
              key={match.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <span>
                {pairName(match.pair_one_id)}{' '}
                <strong>
                  {match.score_sets?.[0]?.one ?? 0} – {match.score_sets?.[0]?.two ?? 0}
                </strong>{' '}
                {pairName(match.pair_two_id)}
              </span>
              <span className="text-xs text-muted-foreground">
                {match.scheduled_at ? new Date(match.scheduled_at).toLocaleDateString('en-CA') : ''}
              </span>
            </div>
          ))}
        {!leagueMatches.some((match) => match.status === 'completed') && (
          <p className="text-sm text-muted-foreground">No scores have been entered.</p>
        )}
      </div>
      {currentUserId && canManageLeagueScores && !leagueEventStarted && (
        <p className="mt-5 text-sm text-muted-foreground">
          Score entry opens when the event starts.
        </p>
      )}
      {currentUserId &&
        leagueEventStarted &&
        (canManageLeagueScores || (scoreableMatches.length > 0 && leagueScoresOpen)) && (
          <form
            className="mt-5 rounded-xl border border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (selectedMatch) void saveLeagueScore(selectedMatch);
            }}
          >
            <h4 className="font-semibold">Add a score</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {canManageLeagueScores
                ? 'Select the court/time slot and league team. The opposing team is assigned automatically.'
                : 'Your league team and its opponents are assigned automatically from your court/time slot.'}
            </p>
            <div
              className={`mt-3 grid gap-3 sm:grid-cols-2 ${canManageLeagueScores ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
            >
              <label className="space-y-1 text-sm">
                Court / sub-session
                <select
                  required
                  value={leagueScoreMatchId}
                  onChange={(event) => {
                    const match = leagueMatches.find((item) => item.id === event.target.value);
                    setLeagueScoreMatchId(event.target.value);
                    setLeagueScoreTeamSide('1');
                    if (match?.status === 'completed') {
                      const ownOnOne = canManageLeagueScores || isOwnPair(match.pair_one_id);
                      setLeagueScoreDrafts((current) => ({
                        ...current,
                        [match.id]: {
                          one: String(match.score_sets?.[0]?.[ownOnOne ? 'one' : 'two'] ?? ''),
                          two: String(match.score_sets?.[0]?.[ownOnOne ? 'two' : 'one'] ?? ''),
                        },
                      }));
                    }
                  }}
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                >
                  <option value="">Select assignment</option>
                  {scoreableMatches.map((match) => (
                    <option key={match.id} value={match.id}>
                      {matchTimeLabel(match)}
                    </option>
                  ))}
                </select>
              </label>
              {canManageLeagueScores && selectedMatch && (
                <label className="space-y-1 text-sm">
                  Team
                  <select
                    required
                    value={leagueScoreTeamSide}
                    onChange={(event) => {
                      const side = event.target.value as '1' | '2';
                      setLeagueScoreTeamSide(side);
                      if (selectedMatch.status === 'completed') {
                        const teamOneSelected = side === '1';
                        setLeagueScoreDrafts((current) => ({
                          ...current,
                          [selectedMatch.id]: {
                            one: String(
                              selectedMatch.score_sets?.[0]?.[teamOneSelected ? 'one' : 'two'] ??
                                '',
                            ),
                            two: String(
                              selectedMatch.score_sets?.[0]?.[teamOneSelected ? 'two' : 'one'] ??
                                '',
                            ),
                          },
                        }));
                      }
                    }}
                    className="block h-10 w-full rounded-md border border-input bg-background px-3"
                  >
                    <option value="1">{pairName(selectedMatch.pair_one_id)}</option>
                    <option value="2">{pairName(selectedMatch.pair_two_id)}</option>
                  </select>
                </label>
              )}
              <label className="space-y-1 text-sm">
                {canManageLeagueScores ? 'Team score' : 'Your team score'}
                <input
                  required
                  type="number"
                  min="0"
                  value={selectedDraft.one}
                  onChange={(event) =>
                    selectedMatch &&
                    setLeagueScoreDrafts((current) => ({
                      ...current,
                      [selectedMatch.id]: { ...selectedDraft, one: event.target.value },
                    }))
                  }
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                />
              </label>
              <label className="space-y-1 text-sm">
                {canManageLeagueScores ? 'Opposing team score' : 'Opponents’ score'}
                <input
                  required
                  type="number"
                  min="0"
                  value={selectedDraft.two}
                  onChange={(event) =>
                    selectedMatch &&
                    setLeagueScoreDrafts((current) => ({
                      ...current,
                      [selectedMatch.id]: { ...selectedDraft, two: event.target.value },
                    }))
                  }
                  className="block h-10 w-full rounded-md border border-input bg-background px-3"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={!selectedMatch || savingLeagueScore === selectedMatch.id}
                  className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {selectedMatch && savingLeagueScore === selectedMatch.id
                    ? 'Saving…'
                    : 'Save score'}
                </button>
              </div>
            </div>
          </form>
        )}
    </section>
  );
}
