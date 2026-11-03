import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateTournamentScore } from '@/lib/tournament-score';
import { hasTwoPlayersPerTeam } from '@/lib/tournament-match';
import type { Match, MatchPlayer } from '@/components/tournament-public-view-types';
import type { TournamentConfig } from '@/lib/tournament-config';

export function useTournamentCaptainActions({
  db,
  currentUserId,
  config,
  matchPlayers,
  setMatchPlayers,
  setMatches,
}: {
  db: SupabaseClient;
  currentUserId: string | null;
  config: TournamentConfig | null;
  matchPlayers: MatchPlayer[];
  setMatchPlayers: Dispatch<SetStateAction<MatchPlayer[]>>;
  setMatches: Dispatch<SetStateAction<Match[]>>;
}) {
  async function saveCaptainPairing(match: Match, teamId: string, side: 1 | 2) {
    const first =
      (document.getElementById(`captain-pair-${match.id}-${side}-a`) as HTMLSelectElement | null)
        ?.value || '';
    const second =
      (document.getElementById(`captain-pair-${match.id}-${side}-b`) as HTMLSelectElement | null)
        ?.value || '';
    if (!first || !second || first === second) {
      window.alert('Select two different players for the doubles pairing.');
      return;
    }
    const { error: deleteError } = await db
      .from('tournament_match_players')
      .delete()
      .eq('match_id', match.id)
      .eq('team_id', teamId);
    if (deleteError) {
      window.alert(deleteError.message);
      return;
    }
    const { error: insertError } = await db.from('tournament_match_players').insert([
      { match_id: match.id, participant_id: first, side, team_id: teamId },
      { match_id: match.id, participant_id: second, side, team_id: teamId },
    ]);
    if (insertError) {
      window.alert(insertError.message);
      return;
    }
    setMatchPlayers((current) => [
      ...current.filter((player) => !(player.match_id === match.id && player.team_id === teamId)),
      { match_id: match.id, participant_id: first, side, team_id: teamId },
      { match_id: match.id, participant_id: second, side, team_id: teamId },
    ]);
  }

  async function saveCaptainScore(match: Match) {
    if (!hasTwoPlayersPerTeam(match, matchPlayers)) {
      window.alert(
        'Assign two players to each team before recording the result so individual records remain accurate.',
      );
      return;
    }
    const input = document.getElementById(`captain-score-${match.id}`) as HTMLInputElement | null;
    const evaluation = evaluateTournamentScore(input?.value ?? '', config?.scoring_template);
    if (evaluation.error !== undefined) {
      window.alert(evaluation.error);
      return;
    }
    const { sets, winner, pointsOne, pointsTwo } = evaluation;
    const { error } = await db
      .from('tournament_matches')
      .update({
        score_sets: sets,
        winner_side: winner,
        status: 'completed',
        team_points_one: pointsOne,
        team_points_two: pointsTwo,
        entered_by: currentUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', match.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    setMatches((current) =>
      current.map((item) =>
        item.id === match.id
          ? {
              ...item,
              score_sets: sets,
              winner_side: winner,
              status: 'completed',
              team_points_one: pointsOne,
              team_points_two: pointsTwo,
            }
          : item,
      ),
    );
  }

  return { saveCaptainPairing, saveCaptainScore };
}
