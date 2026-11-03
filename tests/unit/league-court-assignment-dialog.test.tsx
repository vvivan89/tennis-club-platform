import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LeagueCourtAssignmentDialog,
  type LeagueCourtAssignment,
} from '@/components/league-court-assignment-dialog';

vi.mock('@/components/drag-drop', () => ({
  AssignmentDropZone: ({
    children,
    onDrop,
    variant,
  }: React.PropsWithChildren<{ onDrop: React.DragEventHandler; variant: string }>) => (
    <div data-testid={`drop-${variant}`} onDrop={onDrop}>
      {children}
    </div>
  ),
  DraggableItem: ({
    children,
    onDragStateChange,
  }: React.PropsWithChildren<{ onDragStateChange: (id: string | null) => void }>) => (
    <div onDragStart={() => onDragStateChange('pair-1')} onDragEnd={() => onDragStateChange(null)}>
      {children}
    </div>
  ),
}));

afterEach(cleanup);

describe('LeagueCourtAssignmentDialog', () => {
  const pair = { id: 'pair-1', player_one_name: 'Alex', player_two_name: 'Jordan' };
  const assigned: LeagueCourtAssignment[] = [
    { pair_id: 'pair-1', court_number: 1, segment_order: 1 },
  ];

  it('renders assigned teams, unassigned teams, court capacity and propagates drag/drop actions', () => {
    const move = vi.fn();
    const unassign = vi.fn();
    const { getAllByTestId, getByTestId } = render(
      <LeagueCourtAssignmentDialog
        courtSessionCount={1}
        courtTotal={2}
        leaguePairs={[pair, { ...pair, id: 'pair-2', player_one_name: 'Sam' }]}
        leagueCourtDraft={assigned}
        leagueCourtSaving={false}
        leagueCourtError=""
        setLeagueCourtDraft={vi.fn()}
        setLeagueCourtSessionCount={vi.fn()}
        onClose={vi.fn()}
        onMoveLeaguePairToCourt={move}
        onUnassignLeaguePair={unassign}
        onSaveLeagueCourtAssignments={vi.fn()}
      />,
    );
    expect(screen.getByText('Alex + Jordan')).toBeInTheDocument();
    expect(screen.getByText('(1 teams / 2 player places)')).toBeInTheDocument();
    expect(screen.getByText('Sam + Jordan')).toBeInTheDocument();
    fireEvent.drop(getAllByTestId('drop-court')[1], { dataTransfer: { getData: () => 'pair-2' } });
    fireEvent.drop(getByTestId('drop-unassigned'), { dataTransfer: { getData: () => 'pair-1' } });
    expect(move).toHaveBeenCalledWith('pair-2', 2, 1);
    expect(unassign).toHaveBeenCalledWith('pair-1', 1);
  });

  it('adds and removes sub-sessions while copying first-session assignments', () => {
    const setDraft = vi.fn();
    const setCount = vi.fn();
    const props = {
      courtTotal: 1,
      leaguePairs: [pair],
      leagueCourtSaving: false,
      leagueCourtError: '',
      setLeagueCourtDraft: setDraft,
      setLeagueCourtSessionCount: setCount,
      onClose: vi.fn(),
      onMoveLeaguePairToCourt: vi.fn(),
      onUnassignLeaguePair: vi.fn(),
      onSaveLeagueCourtAssignments: vi.fn(),
    };
    const { rerender } = render(
      <LeagueCourtAssignmentDialog {...props} courtSessionCount={1} leagueCourtDraft={assigned} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-session' }));
    expect(setCount).toHaveBeenCalledWith(2);
    const addDraft = setDraft.mock.calls[0][0] as (
      current: LeagueCourtAssignment[],
    ) => LeagueCourtAssignment[];
    const twoSessions = addDraft(assigned);
    expect(twoSessions).toContainEqual({ ...assigned[0], segment_order: 2 });
    rerender(
      <LeagueCourtAssignmentDialog
        {...props}
        courtSessionCount={2}
        leagueCourtDraft={twoSessions}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sub-session 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove sub-session' }));
    expect(setCount).toHaveBeenLastCalledWith(expect.any(Function));
    const removeDraft = setDraft.mock.calls[1][0] as (
      current: LeagueCourtAssignment[],
    ) => LeagueCourtAssignment[];
    expect(removeDraft(twoSessions)).toEqual(assigned);
  });

  it('shows missing pair/error states and disables saving while busy or without teams', () => {
    const save = vi.fn();
    const { rerender } = render(
      <LeagueCourtAssignmentDialog
        courtSessionCount={1}
        courtTotal={1}
        leaguePairs={[]}
        leagueCourtDraft={[]}
        leagueCourtSaving={true}
        leagueCourtError="Could not save."
        setLeagueCourtDraft={vi.fn()}
        setLeagueCourtSessionCount={vi.fn()}
        onClose={vi.fn()}
        onMoveLeaguePairToCourt={vi.fn()}
        onUnassignLeaguePair={vi.fn()}
        onSaveLeagueCourtAssignments={save}
      />,
    );
    expect(screen.getByText('No paired League teams yet.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    rerender(
      <LeagueCourtAssignmentDialog
        courtSessionCount={1}
        courtTotal={1}
        leaguePairs={[pair]}
        leagueCourtDraft={[{ pair_id: 'stale-pair', court_number: 1, segment_order: 1 }]}
        leagueCourtSaving={false}
        leagueCourtError=""
        setLeagueCourtDraft={vi.fn()}
        setLeagueCourtSessionCount={vi.fn()}
        onClose={vi.fn()}
        onMoveLeaguePairToCourt={vi.fn()}
        onUnassignLeaguePair={vi.fn()}
        onSaveLeagueCourtAssignments={save}
      />,
    );
    expect(
      within(screen.getByTestId('drop-court')).queryByText('Alex + Jordan'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Alex + Jordan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
    expect(save).toHaveBeenCalledOnce();
  });
});
