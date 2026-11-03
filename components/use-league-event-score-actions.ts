import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Match } from '@/components/tournament-public-view-types';

export function useLeagueEventScoreActions({
  db,
  startsAt,
  canManageLeagueScores,
  leagueScoreDrafts,
  leagueScoreTeamSide,
  isOwnPair,
  setSavingLeagueScore,
  setMatches,
  setLeagueScoreDrafts,
  refreshPage,
}: {
  db: SupabaseClient;
  startsAt: string;
  canManageLeagueScores: boolean;
  leagueScoreDrafts: Record<string, { one: string; two: string }>;
  leagueScoreTeamSide: '1' | '2';
  isOwnPair: (pairId: string | null | undefined) => boolean;
  setSavingLeagueScore: Dispatch<SetStateAction<string | null>>;
  setMatches: Dispatch<SetStateAction<Match[]>>;
  setLeagueScoreDrafts: Dispatch<SetStateAction<Record<string, { one: string; two: string }>>>;
  refreshPage: () => void;
}) {
  async function saveLeagueScore(match: Match) {
    if (Date.now() < new Date(startsAt).getTime()) {
      window.alert('Scores cannot be entered before the event start time.');
      return;
    }
    if (
      !canManageLeagueScores &&
      Date.now() - new Date(startsAt).getTime() > 2 * 24 * 60 * 60 * 1000
    ) {
      window.alert('Scores can only be entered within two days of the event.');
      return;
    }
    const draft = leagueScoreDrafts[match.id] ?? { one: '', two: '' };
    const ownOnOne = canManageLeagueScores
      ? leagueScoreTeamSide === '1'
      : isOwnPair(match.pair_one_id);
    const existingOne = match.score_sets?.[0]?.[ownOnOne ? 'one' : 'two'];
    const existingTwo = match.score_sets?.[0]?.[ownOnOne ? 'two' : 'one'];
    const enteredOwnScore = Number(draft.one || (match.status === 'completed' ? existingOne : ''));
    const enteredOpponentScore = Number(
      draft.two || (match.status === 'completed' ? existingTwo : ''),
    );
    const one = ownOnOne ? enteredOwnScore : enteredOpponentScore;
    const two = ownOnOne ? enteredOpponentScore : enteredOwnScore;
    if (!Number.isInteger(one) || !Number.isInteger(two) || one < 0 || two < 0 || one === two) {
      window.alert('Enter two different non-negative scores.');
      return;
    }
    setSavingLeagueScore(match.id);
    const { error } = await db.rpc('submit_league_match_score', {
      p_match_id: match.id,
      p_score_one: one,
      p_score_two: two,
    });
    setSavingLeagueScore(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    setMatches((current) =>
      current.map((item) =>
        item.id === match.id
          ? {
              ...item,
              score_sets: [{ one, two }],
              winner_side: one > two ? 1 : 2,
              status: 'completed',
            }
          : item,
      ),
    );
    setLeagueScoreDrafts((current) => ({ ...current, [match.id]: { one: '', two: '' } }));
    refreshPage();
  }

  return { saveLeagueScore };
}
