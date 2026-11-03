import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TournamentCourtScheduleBoard } from '@/components/tournament-court-schedule-board';

describe('TournamentCourtScheduleBoard', () => {
  it('renders scheduled and unscheduled matches, reports both conflict levels, and moves dropped matches', () => {
    const onMoveMatchToCourt = vi.fn();
    const matches = [
      {
        id: 'scheduled',
        court_number: 1,
        scheduled_at: '2026-11-10T10:00:00Z',
        status: 'scheduled',
      },
      { id: 'unscheduled', court_number: 1, scheduled_at: null, status: 'scheduled' },
      { id: 'cancelled', court_number: 1, scheduled_at: null, status: 'cancelled' },
    ];
    render(
      <TournamentCourtScheduleBoard
        courtCount={1}
        matches={matches}
        conflicts={[
          {
            key: 'danger',
            court: 1,
            severity: 'danger',
            previousPlayers: 'A / B',
            previousTime: '10:00',
            currentPlayers: 'C / D',
            currentTime: '10:00',
          },
          {
            key: 'warning',
            court: 1,
            severity: 'warning',
            previousPlayers: 'E / F',
            previousTime: '11:00',
            currentPlayers: 'G / H',
            currentTime: '11:30',
          },
        ]}
        getMatchLabels={(match) => ({ players: match.id, stage: 'Quarter-final' })}
        formatScheduledTime={() => '10:00 AM'}
        onMoveMatchToCourt={onMoveMatchToCourt}
      />,
    );

    expect(screen.getByText('Scheduling conflicts — immediate overlap')).toBeInTheDocument();
    expect(screen.getByText('Scheduling warnings — insufficient break')).toBeInTheDocument();
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Time not scheduled')).toBeInTheDocument();
    expect(screen.queryByText('cancelled · Quarter-final')).not.toBeInTheDocument();

    const court = screen.getByText('Court 1').parentElement as HTMLElement;
    fireEvent.drop(court, {
      dataTransfer: { getData: () => 'scheduled' },
    });
    expect(onMoveMatchToCourt).toHaveBeenCalledWith('scheduled', 1);
    fireEvent.drop(court, { dataTransfer: { getData: () => '' } });
    expect(onMoveMatchToCourt).toHaveBeenCalledTimes(1);
  });

  it('uses at least one court and omits the conflict panel when there are no conflicts', () => {
    render(
      <TournamentCourtScheduleBoard
        courtCount={0}
        matches={[]}
        conflicts={[]}
        getMatchLabels={() => ({ players: '', stage: '' })}
        formatScheduledTime={(value) => value}
        onMoveMatchToCourt={vi.fn()}
      />,
    );
    expect(screen.getByText('Court 1')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
