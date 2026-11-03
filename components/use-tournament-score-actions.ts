import type { Dispatch, SetStateAction } from 'react';
import { evaluateTournamentScore } from '@/lib/tournament-score';
import { hasTwoPlayersPerTeam } from '@/lib/tournament-match';
import type { TournamentConfig } from '@/lib/tournament-config';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { Match, MatchPlayer, Pair } from '@/components/tournament-management-types';

type Db = ReturnType<typeof createSupabaseBrowserClient>;
type ActionResult = { error: { message: string } | null };
type PendingWalkover = { match: Match; raw: string };

export function useTournamentScoreActions({
  db,
  isTeam,
  config,
  matches,
  pairs,
  matchPlayers,
  pendingDeleteMatch,
  refresh,
  runAction,
  saveMatch,
  syncPromotedKnockoutEntrants,
  setError,
  setMessage,
  setPendingDeleteMatch,
  setPendingWalkoverScore,
}: {
  db: Db;
  isTeam: boolean;
  config: TournamentConfig | null;
  matches: Match[];
  pairs: Pair[];
  matchPlayers: MatchPlayer[];
  pendingDeleteMatch: Match | null;
  refresh: () => Promise<void>;
  runAction: (action: () => PromiseLike<ActionResult>, success: string) => Promise<boolean>;
  saveMatch: (match: Match, changes: Partial<Match>) => Promise<boolean>;
  syncPromotedKnockoutEntrants: () => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingDeleteMatch: Dispatch<SetStateAction<Match | null>>;
  setPendingWalkoverScore: Dispatch<SetStateAction<PendingWalkover | null>>;
}) {
  async function advanceKnockoutWinner(match: Match, winnerSide: 1 | 2) {
    if (!match.phase.includes('knockout')) return;
    const nextMatch = matches.find(
      (item) =>
        item.category === match.category &&
        item.phase === match.phase &&
        item.round_number === match.round_number + 1 &&
        item.match_number === Math.ceil(match.match_number / 2),
    );
    if (!nextMatch) return;
    const targetSide = match.match_number % 2 === 1 ? 1 : 2;
    const winnerId = isTeam
      ? winnerSide === 1
        ? match.team_one_id
        : match.team_two_id
      : winnerSide === 1
        ? match.pair_one_id
        : match.pair_two_id;
    if (!winnerId) return;
    const field = isTeam
      ? targetSide === 1
        ? 'team_one_id'
        : 'team_two_id'
      : targetSide === 1
        ? 'pair_one_id'
        : 'pair_two_id';
    const { error: advanceError } = await db
      .from('tournament_matches')
      .update({ [field]: winnerId, updated_at: new Date().toISOString() })
      .eq('id', nextMatch.id);
    if (advanceError) {
      setError(`Result saved, but the winner could not be advanced: ${advanceError.message}`);
      return;
    }
    if (!isTeam) {
      const winnerPair = pairs.find((pair) => pair.id === winnerId);
      if (winnerPair) {
        const { error: deleteError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('match_id', nextMatch.id)
          .eq('side', targetSide);
        if (deleteError) {
          setError(
            `Winner advanced, but participant history could not be updated: ${deleteError.message}`,
          );
          return;
        }
        const { error: playerError } = await db.from('tournament_match_players').insert([
          {
            match_id: nextMatch.id,
            participant_id: winnerPair.player_one_id,
            side: targetSide,
            team_id: null,
          },
          {
            match_id: nextMatch.id,
            participant_id: winnerPair.player_two_id,
            side: targetSide,
            team_id: null,
          },
        ]);
        if (playerError) {
          setError(
            `Winner advanced, but participant history could not be updated: ${playerError.message}`,
          );
          return;
        }
      }
    }
    await refresh();
  }

  async function recordWalkover(match: Match, winnerSide: 1 | 2) {
    const bonusScoring =
      (config?.scoring_templates?.[
        match.phase as keyof NonNullable<TournamentConfig['scoring_templates']>
      ] ?? config?.scoring_template) === 'team_two_sets_bonus_third';
    const saved = await runAction(
      () =>
        db
          .from('tournament_matches')
          .update({
            winner_side: winnerSide,
            score_sets: match.phase.includes('round_robin')
              ? [
                  winnerSide === 1 ? { one: 6, two: 0 } : { one: 0, two: 6 },
                  winnerSide === 1 ? { one: 6, two: 0 } : { one: 0, two: 6 },
                ]
              : [],
            status: 'completed',
            notes:
              winnerSide === 1
                ? 'Walkover / retirement awarded to side one'
                : 'Walkover / retirement awarded to side two',
            team_points_one: isTeam ? (winnerSide === 1 ? (bonusScoring ? 3 : 1) : 0) : 0,
            team_points_two: isTeam ? (winnerSide === 2 ? (bonusScoring ? 3 : 1) : 0) : 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', match.id),
      'Walkover recorded.',
    );
    if (saved) {
      if (match.phase.includes('round_robin')) {
        try {
          await syncPromotedKnockoutEntrants();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Could not update promoted teams.');
        }
      }
      await advanceKnockoutWinner(match, winnerSide);
    }
  }

  async function deleteMatch(match: Match) {
    setPendingDeleteMatch(match);
  }

  async function confirmDeleteMatch() {
    if (!pendingDeleteMatch) return;
    const match = pendingDeleteMatch;
    setPendingDeleteMatch(null);
    await runAction(
      () => db.from('tournament_matches').delete().eq('id', match.id),
      'Match deleted.',
    );
  }

  async function saveScore(match: Match, raw: string, confirmWalkoverReplacement = false) {
    if (isTeam && !hasTwoPlayersPerTeam(match, matchPlayers)) {
      setError(
        'Assign two players to each team before recording the result so individual records remain accurate.',
      );
      return;
    }
    const scoringTemplate =
      config?.scoring_templates?.[
        match.phase as keyof NonNullable<TournamentConfig['scoring_templates']>
      ] ?? config?.scoring_template;
    const evaluation = evaluateTournamentScore(raw, scoringTemplate);
    if (evaluation.error !== undefined) {
      setError(evaluation.error);
      return;
    }
    const { sets, winner, pointsOne, pointsTwo } = evaluation;
    const isWalkoverResult = /^Walkover \/ retirement awarded to side (one|two)$/i.test(
      match.notes?.trim() ?? '',
    );
    if (isWalkoverResult && !confirmWalkoverReplacement) {
      setPendingWalkoverScore({ match, raw });
      return;
    }
    const scoreSaved = await saveMatch(match, {
      score_sets: sets,
      winner_side: winner,
      status: 'completed',
      team_points_one: pointsOne,
      team_points_two: pointsTwo,
      ...(isWalkoverResult ? { notes: '' } : {}),
    });
    if (!scoreSaved) return;
    setMessage('Match score saved.');
    if (match.phase.includes('round_robin')) {
      try {
        await syncPromotedKnockoutEntrants();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update promoted teams.');
      }
    }
    await advanceKnockoutWinner(match, winner);
  }

  return { advanceKnockoutWinner, recordWalkover, deleteMatch, confirmDeleteMatch, saveScore };
}
