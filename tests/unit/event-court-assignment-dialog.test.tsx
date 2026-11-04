import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventCourtAssignmentDialog } from '@/components/event-court-assignment-dialog';

const emptySession = () => ({ 1: [] as string[], 2: [], 3: [], 4: [] });

function props(overrides: Record<string, unknown> = {}) {
  return {
    modalOpen: true,
    busy: false,
    ladderConfig: true,
    ladderStandings: [
      { userId: 'u1', name: 'Ranked Player', points: 12 },
      { userId: 'u2', name: 'Unranked Player', points: null },
    ],
    sessions: [{ ...emptySession(), 1: ['reg-1', 'missing-registration'] }, emptySession()],
    setSessions: vi.fn(),
    dragging: 'reg-2',
    setDragging: vi.fn(),
    participants: [
      {
        registration_id: 'reg-1',
        user_id: 'u1',
        status: 'confirmed',
        full_name: 'Assigned Player',
        avatar_url: null,
        tennis_skill_level: 3.5,
      },
      {
        registration_id: 'reg-2',
        user_id: 'u2',
        status: 'confirmed',
        full_name: 'Unassigned Player',
        avatar_url: null,
        tennis_skill_level: null,
      },
      {
        registration_id: 'reg-3',
        user_id: 'u3',
        status: 'registered',
        full_name: 'Not Confirmed',
        avatar_url: null,
        tennis_skill_level: null,
      },
    ],
    records: { u1: { wins: 2, losses: 1 } },
    onClose: vi.fn(),
    onAssignLadder: vi.fn(),
    onMovePlayer: vi.fn(),
    onAddSession: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe('EventCourtAssignmentDialog', () => {
  it('stays hidden while closed', () => {
    render(<EventCourtAssignmentDialog {...props({ modalOpen: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders ladder context, confirmed assignments, drop targets, and busy actions', () => {
    const p = props({ busy: true });
    render(<EventCourtAssignmentDialog {...p} />);

    expect(screen.getByRole('dialog', { name: 'Assign courts' })).toBeInTheDocument();
    expect(screen.getByText('12 pts')).toBeInTheDocument();
    expect(screen.getByText(/Unranked Player · Unranked/)).toBeInTheDocument();
    expect(screen.getAllByText('Assigned Player')).toHaveLength(2);
    expect(screen.getAllByText('Unassigned Player')).toHaveLength(2);
    expect(screen.queryByText('Not Confirmed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Automatic ladder assignment/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Remove sub-session' })).toHaveLength(2);

    fireEvent.drop(screen.getAllByText(/Court 2/)[0].parentElement!, {
      dataTransfer: { getData: () => '' },
    });
    expect(p.onMovePlayer).toHaveBeenCalledWith('reg-2', 2, 0);
  });

  it('supports assignment removal and the dialog controls', () => {
    const p = props({
      ladderConfig: false,
      ladderStandings: [],
      dragging: null,
    });
    render(<EventCourtAssignmentDialog {...p} />);

    expect(
      screen.queryByRole('button', { name: 'Automatic ladder assignment' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Current ladder ranking for registered players'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove sub-session' })[0]);
    expect(p.setSessions).toHaveBeenCalledWith(expect.any(Function));

    const unassigned = screen.getAllByText('Unassigned players')[0].parentElement!;
    fireEvent.drop(unassigned, { dataTransfer: { getData: () => 'reg-1' } });
    expect(p.setSessions).toHaveBeenCalledTimes(2);
    expect(p.setDragging).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onAddSession).toHaveBeenCalledOnce();
    expect(p.onSave).toHaveBeenCalledOnce();
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
