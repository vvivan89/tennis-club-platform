import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentCompetitionResults } from '@/components/tournament-competition-results';
import { useTournamentCaptainActions } from '@/components/use-tournament-captain-actions';
import { useTournamentMatchLineupRefresh } from '@/components/use-tournament-match-lineup-refresh';
import type { Match, MatchPlayer } from '@/components/tournament-public-view-types';
import type { SupabaseClient } from '@supabase/supabase-js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 60_000).toISOString();

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-1',
    event_id: 'event-1',
    category: 'men',
    phase: 'team_round_robin',
    group_number: 1,
    round_number: 1,
    match_number: 1,
    pair_one_id: null,
    pair_two_id: null,
    team_one_id: 'team-1',
    team_two_id: 'team-2',
    scheduled_at: past,
    court_number: 1,
    score_sets: [],
    winner_side: null,
    team_points_one: 0,
    team_points_two: 0,
    status: 'scheduled',
    team_one_name: 'Aces',
    team_two_name: 'Rockets',
    player_one_name: null,
    player_two_name: null,
    opponent_one_name: null,
    opponent_two_name: null,
    ...overrides,
  };
}

function renderResults(
  match: Match,
  saveCaptainScore = vi.fn().mockResolvedValue(true),
  scoringTemplate = 'one_set',
) {
  return {
    saveCaptainScore,
    ...render(
      <TournamentCompetitionResults
        leagueTournament={false}
        leagueStandingsBefore={[]}
        leagueStandingsAfter={[]}
        leagueHasResults={false}
        eventStartsAt={past}
        knockoutMatches={[]}
        bracketStageLabel={() => ''}
        bracketSideLabel={() => ''}
        categoryVisibleMatches={[match]}
        format="team"
        activeCategory="men"
        groupStandings={[]}
        rankingColumns={[]}
        rankingColumnLabel={{}}
        isOwnCompetitionEntry={() => false}
        groupOverrides={[]}
        enabledPhases={{ team_round_robin: true }}
        config={{
          categories: ['men'],
          phases: { team_round_robin: true },
          scoring_templates: { team_round_robin: scoringTemplate },
        }}
        hasAdminContent={false}
        openGroupOverrideEditor={vi.fn()}
        resultsOnly={false}
        competitionMatchGrouping="round"
        setCompetitionMatchGrouping={vi.fn()}
        participants={[]}
        pairs={[]}
        teams={[
          {
            id: 'team-1',
            name: 'Aces',
            logo_url: null,
            color: '',
            group_number: 1,
            captain_user_id: 'captain',
            captain_name: null,
          },
          {
            id: 'team-2',
            name: 'Rockets',
            logo_url: null,
            color: '',
            group_number: 1,
            captain_user_id: 'other-captain',
            captain_name: null,
          },
        ]}
        currentUserId="captain"
        matchPlayers={[]}
        saveCaptainPairing={vi.fn()}
        saveCaptainScore={saveCaptainScore}
        isOwnPair={() => false}
        ownTeamIds={[]}
        roundRobinRoundByMatch={new Map([[match.id, 1]])}
      />,
    ),
  };
}

describe('captain match result flow', () => {
  it('shows team points only for the bonus third-set scoring template', () => {
    const completedMatch = makeMatch({
      score_sets: [
        { one: 6, two: 4 },
        { one: 6, two: 2 },
      ],
      winner_side: 1,
      team_points_one: 1,
      team_points_two: 0,
      status: 'completed',
    });

    const bonusView = renderResults(completedMatch, vi.fn(), 'team_two_sets_bonus_third');
    expect(screen.getByText(/Team standings points: 3/)).toBeInTheDocument();
    bonusView.unmount();

    renderResults(completedMatch, vi.fn(), 'best_of_three');
    expect(screen.queryByText(/Team standings points:/)).not.toBeInTheDocument();
  });

  it('replaces the saved score input with a pencil dialog for editing', async () => {
    const user = userEvent.setup();
    const match = makeMatch({
      score_sets: [{ one: 6, two: 4 }],
      winner_side: 1,
      status: 'completed',
    });
    const saveCaptainScore = vi.fn().mockResolvedValue(true);
    renderResults(match, saveCaptainScore);

    expect(screen.queryByPlaceholderText('6-4, 3-6, 10-8')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save result' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit result for Aces vs Rockets' }));
    expect(screen.getByRole('heading', { name: 'Edit match result' })).toBeInTheDocument();

    const score = screen.getByLabelText('Match score (sets)');
    await user.clear(score);
    await user.type(score, '6-2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveCaptainScore).toHaveBeenCalledWith(match, '6-2'));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Edit match result' })).not.toBeInTheDocument(),
    );
  });

  it('offers initial score entry only after the scheduled start', () => {
    renderResults(makeMatch({ scheduled_at: past }));
    expect(screen.getByRole('button', { name: 'Save result' })).toBeInTheDocument();
    cleanup();

    renderResults(makeMatch({ scheduled_at: future }));
    expect(screen.queryByRole('button', { name: 'Save result' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit result for Aces vs Rockets' }),
    ).not.toBeInTheDocument();
  });

  it('shows a success toast after the database accepts the captain score', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const setSuccessMessage = vi.fn();
    const match = makeMatch({
      score_sets: [{ one: 6, two: 4 }],
      winner_side: 1,
      status: 'completed',
    });
    const { result } = renderHook(() =>
      useTournamentCaptainActions({
        db: { rpc } as unknown as SupabaseClient,
        config: {
          scoring_templates: { team_round_robin: 'team_two_sets_bonus_third' },
        },
        eventStartsAt: past,
        setMatchPlayers: vi.fn(),
        setMatches: vi.fn(),
        setActionMessage: vi.fn(),
        setSuccessMessage,
      }),
    );

    await act(async () => {
      await result.current.saveCaptainScore(match, '6-2, 6-4');
    });

    expect(rpc).toHaveBeenCalledWith('save_captain_team_match_result', {
      p_match_id: 'match-1',
      p_score_sets: [
        { one: 6, two: 2 },
        { one: 6, two: 4 },
      ],
      p_winner_side: 1,
      p_team_points_one: 3,
      p_team_points_two: 0,
    });
    expect(setSuccessMessage).toHaveBeenCalledWith('Match result saved.');
  });

  it('validates captain lineups, reports RPC failures, and updates a successful lineup', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const setActionMessage = vi.fn();
    let savedPlayers: MatchPlayer[] = [
      { match_id: 'match-1', participant_id: 'old-one', side: 1 as const, team_id: 'team-1' },
      { match_id: 'other-match', participant_id: 'keep', side: 1 as const, team_id: 'team-1' },
    ];
    let savedMatches = [makeMatch()];
    const { result } = renderHook(() =>
      useTournamentCaptainActions({
        db: { rpc } as unknown as SupabaseClient,
        config: null,
        eventStartsAt: past,
        setMatchPlayers: (update) => {
          savedPlayers = typeof update === 'function' ? update(savedPlayers) : update;
        },
        setMatches: (update) => {
          savedMatches = typeof update === 'function' ? update(savedMatches) : update;
        },
        setActionMessage,
        setSuccessMessage: vi.fn(),
      }),
    );

    await act(async () => result.current.saveCaptainPairing(makeMatch(), 'team-1', 1));
    expect(setActionMessage).toHaveBeenLastCalledWith(
      'Select two different players for the doubles pairing.',
    );
    expect(rpc).not.toHaveBeenCalled();

    document.body.innerHTML += `
      <select id="captain-pair-match-1-1-a"><option value="p1" selected>p1</option></select>
      <select id="captain-pair-match-1-1-b"><option value="p1" selected>p1</option><option value="p2">p2</option></select>
      <input id="captain-lineup-visible-match-1-1" type="checkbox" checked />`;
    await act(async () => result.current.saveCaptainPairing(makeMatch(), 'team-1', 1));
    expect(setActionMessage).toHaveBeenLastCalledWith(
      'Select two different players for the doubles pairing.',
    );
    (document.getElementById('captain-pair-match-1-1-b') as HTMLSelectElement).value = 'p2';

    rpc.mockResolvedValueOnce({ error: { message: 'Lineup rejected.' } });
    await act(async () => result.current.saveCaptainPairing(makeMatch(), 'team-1', 1));
    expect(setActionMessage).toHaveBeenLastCalledWith('Lineup rejected.');

    rpc.mockResolvedValueOnce({ error: null });
    await act(async () => result.current.saveCaptainPairing(makeMatch(), 'team-1', 1));
    expect(rpc).toHaveBeenLastCalledWith('save_tournament_captain_match_lineup', {
      p_match_id: 'match-1',
      p_team_id: 'team-1',
      p_player_one: 'p1',
      p_player_two: 'p2',
      p_visible_to_public: true,
    });
    expect(savedPlayers).toHaveLength(3);
    expect(savedPlayers.slice(-2)).toEqual([
      { match_id: 'match-1', participant_id: 'p1', side: 1, team_id: 'team-1' },
      { match_id: 'match-1', participant_id: 'p2', side: 1, team_id: 'team-1' },
    ]);
    expect(savedMatches[0].team_one_lineup_public).toBe(true);
  });

  it('blocks future and invalid captain scores and surfaces a score RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'Score rejected.' } });
    const setActionMessage = vi.fn();
    const { result } = renderHook(() =>
      useTournamentCaptainActions({
        db: { rpc } as unknown as SupabaseClient,
        config: null,
        eventStartsAt: past,
        setMatchPlayers: vi.fn(),
        setMatches: vi.fn(),
        setActionMessage,
        setSuccessMessage: vi.fn(),
      }),
    );

    let saved = true;
    await act(async () => {
      saved = await result.current.saveCaptainScore(makeMatch({ scheduled_at: future }), '6-2');
    });
    expect(saved).toBe(false);
    expect(setActionMessage).toHaveBeenLastCalledWith(
      'A match result can only be entered after its scheduled start time.',
    );
    expect(rpc).not.toHaveBeenCalled();

    await act(async () => {
      saved = await result.current.saveCaptainScore(makeMatch(), 'invalid score');
    });
    expect(saved).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    await act(async () => {
      saved = await result.current.saveCaptainScore(makeMatch(), '6-2, 6-4');
    });
    expect(saved).toBe(false);
    expect(setActionMessage).toHaveBeenLastCalledWith('Score rejected.');
  });

  it('reloads match visibility when a scheduled start time passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
    const setRegistrationRefresh = vi.fn();
    renderHook(() =>
      useTournamentMatchLineupRefresh({
        matches: [makeMatch({ scheduled_at: '2026-11-03T12:01:00.000Z' })],
        eventStartsAt: '2026-11-03T12:00:00.000Z',
        setRegistrationRefresh,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(60_050);
    });

    expect(setRegistrationRefresh).toHaveBeenCalledWith(expect.any(Function));
    const update = setRegistrationRefresh.mock.calls[0][0] as (value: number) => number;
    expect(update(2)).toBe(3);
  });
});
