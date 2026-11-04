import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TournamentOverviewParticipants } from '@/components/tournament-overview-participants';

function baseProps(
  overrides: Record<string, unknown> = {},
): ComponentProps<typeof TournamentOverviewParticipants> {
  return {
    canViewCompetition: true,
    format: 'individual',
    teams: [],
    activeCategory: 'open',
    participants: [],
    pairs: [],
    leagueTournament: false,
    leagueCourtView: 'courts',
    setLeagueCourtView: vi.fn(),
    activeLeaguePairs: [],
    leaguePairs: [],
    leagueCourtAssignments: [],
    matches: [],
    unpairedLeagueParticipants: [],
    courtTotal: 2,
    leagueTimeSlots: [],
    leagueScheduledMatches: [],
    ownTeamIds: [],
    ownParticipantIds: [],
    isOwnPair: vi.fn(() => false),
    ...overrides,
  } as unknown as ComponentProps<typeof TournamentOverviewParticipants>;
}

describe('TournamentOverviewParticipants', () => {
  it('hides participant sections when they are not viewable or have no entries', () => {
    const { rerender } = render(<TournamentOverviewParticipants {...baseProps()} />);
    expect(screen.queryByLabelText('Registered Participants')).not.toBeInTheDocument();
    rerender(
      <TournamentOverviewParticipants
        {...baseProps({
          canViewCompetition: false,
          teams: [{ id: 'team-1', name: 'Aces' }],
          format: 'team',
        })}
      />,
    );
    expect(screen.queryByText('Aces')).not.toBeInTheDocument();
  });

  it('shows team players and highlights the signed-in team', () => {
    render(
      <TournamentOverviewParticipants
        {...baseProps({
          format: 'team',
          teams: [{ id: 'team-1', name: 'Aces' }],
          participants: [
            { id: 'p1', team_id: 'team-1', display_name: 'Alex', tennis_skill_level: 4 },
          ],
          ownTeamIds: ['team-1'],
        })}
      />,
    );
    expect(screen.getByText('Aces')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows active pairs and unpaired participants while filtering withdrawn and other categories', () => {
    render(
      <TournamentOverviewParticipants
        {...baseProps({
          pairs: [
            {
              id: 'pair-1',
              category: 'open',
              status: 'confirmed',
              player_one_id: 'p2',
              player_two_id: 'p4',
              player_one_name: 'Alex',
              player_two_name: 'Sam',
            },
            {
              id: 'pair-2',
              category: 'open',
              status: 'withdrawn',
              player_one_name: 'Gone',
              player_two_name: 'Away',
            },
            {
              id: 'pair-3',
              category: 'women',
              status: 'confirmed',
              player_one_name: 'Other',
              player_two_name: 'Category',
            },
          ],
          participants: [
            {
              id: 'p1',
              category: 'open',
              status: 'registered',
              display_name: 'Solo',
              tennis_skill_level: 3,
            },
            { id: 'p2', category: 'open', status: 'registered', display_name: 'Already paired' },
            {
              id: 'p3',
              category: 'women',
              status: 'registered',
              display_name: 'Different category',
            },
          ],
          ownParticipantIds: ['p1'],
          isOwnPair: (id: string) => id === 'pair-1',
        })}
      />,
    );
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Solo')).toBeInTheDocument();
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(screen.queryByText('Already paired')).not.toBeInTheDocument();
    expect(screen.getAllByText('You')).toHaveLength(2);
  });

  it('shows League list assignments, legacy scheduled courts, and unpaired players', () => {
    render(
      <TournamentOverviewParticipants
        {...baseProps({
          leagueTournament: true,
          leagueCourtView: 'list',
          pairs: [{ id: 'pair-1', category: 'open', status: 'confirmed' }],
          activeLeaguePairs: [
            {
              id: 'pair-1',
              player_one_id: 'player-1',
              player_two_id: 'player-2',
              player_one_name: 'Alex',
              player_two_name: 'Sam',
              player_one_skill_level: 4,
              player_two_skill_level: null,
            },
          ],
          leagueCourtAssignments: [{ pair_id: 'pair-1', court_number: 2, segment_order: 2 }],
          matches: [
            {
              id: 'm1',
              pair_one_id: 'pair-1',
              pair_two_id: null,
              scheduled_at: '2026-11-03T20:00:00Z',
              court_number: 1,
              match_number: 1,
            },
          ],
          unpairedLeagueParticipants: [
            { id: 'player-3', display_name: 'Solo', tennis_skill_level: 2 },
          ],
          leagueTimeSlots: [],
          participants: [
            { id: 'player-1', status: 'registered', display_name: 'Alex' },
            { id: 'player-2', status: 'withdrawn', display_name: 'Sam' },
            { id: 'player-3', status: 'registered', display_name: 'Solo', tennis_skill_level: 2 },
          ],
        })}
      />,
    );
    expect(screen.getByText('Court assignments')).toBeInTheDocument();
    expect(screen.getByText('Court 2')).toBeInTheDocument();
    expect(screen.getByText('Solo')).toBeInTheDocument();
    expect(screen.getAllByText('Registered').length).toBeGreaterThan(0);
  });

  it('switches League court view and shows court cards, scheduled matches, waitlist, or empty state', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TournamentOverviewParticipants
        {...baseProps({
          leagueTournament: true,
          leagueCourtView: 'courts',
          setLeagueCourtView: onChange,
          pairs: [{ id: 'pair-1', category: 'open', status: 'confirmed' }],
          activeLeaguePairs: [{ id: 'pair-1', player_one_name: 'Alex', player_two_name: 'Sam' }],
          leaguePairs: [{ id: 'pair-1', player_one_name: 'Alex', player_two_name: 'Sam' }],
          leagueCourtAssignments: [{ pair_id: 'pair-1', court_number: 1, segment_order: 1 }],
          courtTotal: 1,
          participants: [
            {
              id: 'wait-1',
              category: 'open',
              status: 'waitlisted',
              display_name: 'Waiting player',
            },
          ],
          leagueTimeSlots: ['unscheduled'],
          leagueScheduledMatches: [
            {
              id: 'm1',
              scheduled_at: null,
              court_number: 1,
              match_number: 1,
              player_one_name: null,
              opponent_one_name: null,
            },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(onChange).toHaveBeenCalledWith('list');
    expect(screen.getByText('Team court assignments')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Sub-session to be announced')).toBeInTheDocument();
    expect(screen.getByText('Player 1')).toBeInTheDocument();
    expect(screen.getByText('Waiting player')).toBeInTheDocument();

    rerender(
      <TournamentOverviewParticipants
        {...baseProps({
          leagueTournament: true,
          leagueCourtView: 'courts',
          pairs: [{ id: 'pair-1', category: 'open', status: 'confirmed' }],
          participants: [
            {
              id: 'registered-1',
              category: 'open',
              status: 'registered',
              display_name: 'Registered player',
            },
            {
              id: 'wait-1',
              category: 'open',
              status: 'waitlisted',
              display_name: 'Waiting player',
            },
          ],
          unpairedLeagueParticipants: [{ id: 'wait-1', display_name: 'Waiting player' }],
        })}
      />,
    );
    expect(screen.getByText('No court assignments yet.')).toBeInTheDocument();
    expect(screen.getByText('Players without an assigned team')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting player')).toHaveLength(2);
  });
});
