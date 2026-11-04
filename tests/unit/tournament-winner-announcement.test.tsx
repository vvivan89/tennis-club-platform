import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TournamentPublicViewControls } from '@/components/tournament-public-view-controls';
import { buildTournamentGroupStandings } from '@/components/tournament-public-group-standings';
import { buildTournamentWinnerSummaries } from '@/components/tournament-winner-summaries';
import type { Match, Pair, Team } from '@/components/tournament-public-view-types';
import { haveAllScheduledTournamentMatchesBeenPlayed } from '@/lib/tournament-winner-announcement';

function renderControls(overrides: Record<string, unknown> = {}) {
  const onToggleWinnersAnnouncement = vi.fn();
  render(
    <TournamentPublicViewControls
      resultsOnly={false}
      winnerSummaries={[]}
      adminWinnerPreview={[]}
      isManager={false}
      allScheduledMatchesPlayed={false}
      winnersAnnounced={false}
      announcementBusy={false}
      onToggleWinnersAnnouncement={onToggleWinnersAnnouncement}
      hasRules={false}
      leagueTournament={false}
      hasAdminContent={false}
      isTeamCaptain={false}
      captainOnlyView={false}
      tab="overview"
      setTab={vi.fn()}
      activeCategory="mixed"
      setActiveCategory={vi.fn()}
      format="doubles"
      config={{ categories: ['mixed'] }}
      onAssignCourts={vi.fn()}
      {...overrides}
    />,
  );
  return onToggleWinnersAnnouncement;
}

describe('tournament winner announcements', () => {
  it('requires all actual matches to have a recorded outcome and ignores byes/cancellations', () => {
    expect(
      haveAllScheduledTournamentMatchesBeenPlayed([
        { status: 'completed', winner_side: 1 },
        { status: 'bye', winner_side: 1 },
        { status: 'cancelled', winner_side: null },
      ]),
    ).toBe(true);
    expect(
      haveAllScheduledTournamentMatchesBeenPlayed([
        { status: 'completed', winner_side: 1 },
        { status: 'scheduled', winner_side: null },
      ]),
    ).toBe(false);
    expect(haveAllScheduledTournamentMatchesBeenPlayed([])).toBe(false);
  });

  it('uses completed round-robin standings when no knockout matches were created', () => {
    const pairs: Pair[] = [
      {
        id: 'pair-a',
        event_id: 'event-1',
        category: 'mixed',
        player_one_id: 'a1',
        player_two_id: 'a2',
        group_number: 1,
        seed: null,
        status: 'active',
        player_one_name: 'Alex',
        player_two_name: 'Jordan',
      },
      {
        id: 'pair-b',
        event_id: 'event-1',
        category: 'mixed',
        player_one_id: 'b1',
        player_two_id: 'b2',
        group_number: 1,
        seed: null,
        status: 'active',
        player_one_name: 'Taylor',
        player_two_name: 'Casey',
      },
    ];
    const match = {
      id: 'match-1',
      event_id: 'event-1',
      category: 'mixed',
      phase: 'round_robin',
      group_number: 1,
      round_number: 1,
      match_number: 1,
      pair_one_id: 'pair-a',
      pair_two_id: 'pair-b',
      team_one_id: null,
      team_two_id: null,
      scheduled_at: '2026-11-01T12:00:00Z',
      court_number: 1,
      score_sets: [{ one: 6, two: 2 }],
      winner_side: 1,
      team_points_one: 0,
      team_points_two: 0,
      status: 'completed',
    } as Match;
    const config = {
      categories: ['mixed'],
      phases: { round_robin: true, final_knockout: true },
      group_count: 1,
      ranking_priority: ['matches_won'],
    };
    const groupStandings = buildTournamentGroupStandings({
      visibleMatches: [match],
      teams: [],
      pairs,
      config,
      format: 'doubles',
      groupOverrides: [],
    });

    expect(
      buildTournamentWinnerSummaries({
        matches: [match],
        teams: [],
        pairs,
        config,
        format: 'doubles',
        groupStandings,
      }),
    ).toEqual([{ category: 'mixed', winners: ['Alex + Jordan'] }]);
  });

  it('calculates the winner for a completed team tournament round robin', () => {
    const teams: Team[] = [
      {
        id: 'team-a',
        name: 'Court Chaos',
        logo_url: null,
        color: '',
        group_number: null,
        captain_user_id: null,
        captain_name: null,
      },
      {
        id: 'team-b',
        name: 'Team 2',
        logo_url: null,
        color: '',
        group_number: null,
        captain_user_id: null,
        captain_name: null,
      },
    ];
    const match = {
      id: 'team-match',
      event_id: 'team-event',
      category: 'men',
      phase: 'team_round_robin',
      group_number: null,
      round_number: 1,
      match_number: 1,
      pair_one_id: null,
      pair_two_id: null,
      team_one_id: 'team-a',
      team_two_id: 'team-b',
      scheduled_at: '2026-11-03T23:30:00Z',
      court_number: 1,
      score_sets: [
        { one: 6, two: 3 },
        { one: 2, two: 6 },
        { one: 7, two: 6 },
      ],
      winner_side: 1,
      team_points_one: 2,
      team_points_two: 1,
      status: 'completed',
    } as Match;
    const config = {
      categories: ['mixed', 'men', 'women'],
      phases: { team_round_robin: true, team_knockout: false },
      group_count: 1,
      ranking_priority: ['points', 'matches_won', 'sets_won', 'games_won'],
      scoring_templates: { team_round_robin: 'team_two_sets_bonus_third' },
    };
    const groupStandings = buildTournamentGroupStandings({
      visibleMatches: [match],
      teams,
      pairs: [],
      config,
      format: 'team',
      groupOverrides: [],
    });

    expect(haveAllScheduledTournamentMatchesBeenPlayed([match])).toBe(true);
    expect(
      buildTournamentWinnerSummaries({
        matches: [match],
        teams,
        pairs: [],
        config,
        format: 'team',
        groupStandings,
      }),
    ).toEqual([{ category: 'men', winners: ['Court Chaos'] }]);
  });

  it('shows the announce action to managers only after all matches are played', () => {
    renderControls({ isManager: true });
    expect(screen.queryByRole('region', { name: 'Tournament winner announcement' })).toBeNull();

    renderControls({ isManager: true, allScheduledMatchesPlayed: true });
    expect(screen.getByText('Results of all matches are recorded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Announce winners' })).toBeInTheDocument();
  });

  it('lets managers unannounce winners and keeps the action hidden from non-managers', () => {
    renderControls({
      isManager: true,
      winnersAnnounced: true,
      winnerSummaries: [{ category: 'mixed', winners: ['Alex + Jordan'] }],
    });
    expect(screen.getByRole('button', { name: 'Unannounce winners' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Announced winners' })).toHaveTextContent(
      'Mixed doublesAlex + Jordan',
    );

    renderControls({ allScheduledMatchesPlayed: true });
    expect(screen.queryByRole('button', { name: 'Announce winners' })).toBeNull();
  });

  it('shows a private category and winner preview to managers before announcement', () => {
    renderControls({
      isManager: true,
      allScheduledMatchesPlayed: true,
      adminWinnerPreview: [{ category: 'men', winners: ['Court Chaos'] }],
    });

    const preview = screen.getByRole('list', { name: 'Winner preview' });
    expect(preview).toHaveTextContent("Men's doubles");
    expect(preview).toHaveTextContent('Court Chaos');
    expect(
      screen.getByText(/They will appear publicly after you announce them/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tournament winners' })).not.toBeInTheDocument();
  });

  it('does not expose the admin preview or winner cards to the public before announcement', () => {
    renderControls({
      adminWinnerPreview: [{ category: 'men', winners: ['Court Chaos'] }],
      winnerSummaries: [],
    });

    expect(screen.queryByText('Court Chaos')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tournament winner announcement' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tournament winners' })).toBeNull();
  });

  it('calls the announcement action and disables it while saving', () => {
    const onToggle = renderControls({
      isManager: true,
      allScheduledMatchesPlayed: true,
      announcementBusy: true,
    });
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('invokes the manager action when the announce button is available', () => {
    const onToggle = renderControls({ isManager: true, allScheduledMatchesPlayed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Announce winners' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
