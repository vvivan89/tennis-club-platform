export type TournamentMatchCore = {
  id: string;
  category: string;
  phase: string;
  group_number: number | null;
  round_number: number;
  match_number: number;
  pair_one_id: string | null;
  pair_two_id: string | null;
  team_one_id: string | null;
  team_two_id: string | null;
  scheduled_at: string | null;
  court_number: number | null;
  score_sets: Array<{ one: number; two: number }>;
  winner_side: number | null;
  team_points_one: number;
  team_points_two: number;
  status: string;
};

type PairLike = { id: string; player_one_id: string; player_two_id: string };

/** One tournament_match_players row per player for a match between two known pairs. */
export function pairMatchPlayerRows(
  match: { id: string; pair_one_id: string | null; pair_two_id: string | null },
  pairs: PairLike[],
) {
  const one = pairs.find((pair) => pair.id === match.pair_one_id);
  const two = pairs.find((pair) => pair.id === match.pair_two_id);
  if (!one || !two) return [];
  return [
    { match_id: match.id, participant_id: one.player_one_id, side: 1, team_id: null },
    { match_id: match.id, participant_id: one.player_two_id, side: 1, team_id: null },
    { match_id: match.id, participant_id: two.player_one_id, side: 2, team_id: null },
    { match_id: match.id, participant_id: two.player_two_id, side: 2, team_id: null },
  ];
}

const scheduledTime = (match: { scheduled_at: string | null }) =>
  match.scheduled_at ? new Date(match.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;

/** Orders by start time, then court; unscheduled matches and unassigned courts go last. */
export function compareByScheduleThenCourt(
  a: { scheduled_at: string | null; court_number: number | null },
  b: { scheduled_at: string | null; court_number: number | null },
) {
  return (
    scheduledTime(a) - scheduledTime(b) ||
    (a.court_number ?? Number.MAX_SAFE_INTEGER) - (b.court_number ?? Number.MAX_SAFE_INTEGER)
  );
}

export function compareByScheduleThenMatchNumber(
  a: { scheduled_at: string | null; match_number: number },
  b: { scheduled_at: string | null; match_number: number },
) {
  return scheduledTime(a) - scheduledTime(b) || a.match_number - b.match_number;
}

/** Numbers each match by how many matches its sides have already played in the given order. */
export function roundNumbersByMatch(
  orderedMatches: Array<
    Pick<
      TournamentMatchCore,
      'id' | 'round_number' | 'team_one_id' | 'team_two_id' | 'pair_one_id' | 'pair_two_id'
    >
  >,
  isTeam: boolean,
) {
  const counts = new Map<string, number>();
  const result = new Map<string, number>();
  for (const match of orderedMatches) {
    const first = isTeam ? match.team_one_id : match.pair_one_id;
    const second = isTeam ? match.team_two_id : match.pair_two_id;
    const firstRound = first ? (counts.get(first) ?? 0) + 1 : match.round_number;
    const secondRound = second ? (counts.get(second) ?? 0) + 1 : match.round_number;
    if (first) counts.set(first, firstRound);
    if (second) counts.set(second, secondRound);
    result.set(match.id, Math.min(firstRound, secondRound));
  }
  return result;
}

/** True when each team in the match has exactly two assigned players. */
export function hasTwoPlayersPerTeam(
  match: Pick<TournamentMatchCore, 'id' | 'team_one_id' | 'team_two_id'>,
  matchPlayers: Array<{ match_id: string; side: number; team_id: string | null }>,
) {
  return ([1, 2] as const).every(
    (side) =>
      matchPlayers.filter(
        (player) =>
          player.match_id === match.id &&
          player.side === side &&
          player.team_id === (side === 1 ? match.team_one_id : match.team_two_id),
      ).length === 2,
  );
}
