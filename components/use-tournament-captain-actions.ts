import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateTournamentScore, teamMatchPoints } from '@/lib/tournament-score';
import { getTournamentScoringTemplate } from '@/lib/tournament-config';
import type { Match, MatchPlayer } from '@/components/tournament-public-view-types';
import type { TournamentConfig } from '@/lib/tournament-config';

export function useTournamentCaptainActions({
  db,
  config,
  eventStartsAt,
  setMatchPlayers,
  setMatches,
  setActionMessage,
  setSuccessMessage,
}: {
  db: SupabaseClient;
  config: TournamentConfig | null;
  eventStartsAt: string;
  setMatchPlayers: Dispatch<SetStateAction<MatchPlayer[]>>;
  setMatches: Dispatch<SetStateAction<Match[]>>;
  setActionMessage: (message: string) => void;
  setSuccessMessage: (message: string) => void;
}) {
  async function saveCaptainPairing(match: Match, teamId: string, side: 1 | 2) {
    const first =
      (document.getElementById(`captain-pair-${match.id}-${side}-a`) as HTMLSelectElement | null)
        ?.value || '';
    const second =
      (document.getElementById(`captain-pair-${match.id}-${side}-b`) as HTMLSelectElement | null)
        ?.value || '';
    if (!first || !second || first === second) {
      setActionMessage('Select two different players for the doubles pairing.');
      return;
    }
    const visible =
      (
        document.getElementById(
          `captain-lineup-visible-${match.id}-${side}`,
        ) as HTMLInputElement | null
      )?.checked ?? false;
    const { error } = await db.rpc('save_tournament_captain_match_lineup', {
      p_match_id: match.id,
      p_team_id: teamId,
      p_player_one: first,
      p_player_two: second,
      p_visible_to_public: visible,
    });
    if (error) {
      setActionMessage(error.message);
      return;
    }
    setMatchPlayers((current) => [
      ...current.filter((player) => !(player.match_id === match.id && player.team_id === teamId)),
      { match_id: match.id, participant_id: first, side, team_id: teamId },
      { match_id: match.id, participant_id: second, side, team_id: teamId },
    ]);
    setMatches((current) =>
      current.map((item) =>
        item.id === match.id
          ? {
              ...item,
              team_one_lineup_public: side === 1 ? visible : item.team_one_lineup_public,
              team_two_lineup_public: side === 2 ? visible : item.team_two_lineup_public,
            }
          : item,
      ),
    );
  }

  async function saveCaptainScore(match: Match, rawScore?: string): Promise<boolean> {
    const matchStart = new Date(match.scheduled_at || eventStartsAt).getTime();
    if (Date.now() < matchStart) {
      setActionMessage('A match result can only be entered after its scheduled start time.');
      return false;
    }

    const input = document.getElementById(`captain-score-${match.id}`) as HTMLInputElement | null;
    const scoringTemplate = getTournamentScoringTemplate(config, match.phase);
    const evaluation = evaluateTournamentScore(rawScore ?? input?.value ?? '', scoringTemplate);
    if (evaluation.error !== undefined) {
      setActionMessage(evaluation.error);
      return false;
    }

    const { sets, winner } = evaluation;
    const { pointsOne, pointsTwo } = teamMatchPoints(sets, scoringTemplate);
    const { error } = await db.rpc('save_captain_team_match_result', {
      p_match_id: match.id,
      p_score_sets: sets,
      p_winner_side: winner,
      p_team_points_one: pointsOne,
      p_team_points_two: pointsTwo,
    });
    if (error) {
      setActionMessage(error.message);
      return false;
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
    setSuccessMessage('Match result saved.');
    return true;
  }

  return { saveCaptainPairing, saveCaptainScore };
}
