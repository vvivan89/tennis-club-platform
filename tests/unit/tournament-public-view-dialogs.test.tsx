import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TournamentPublicViewDialogs } from '@/components/tournament-public-view-dialogs';

vi.mock('@/components/confirm-dialog', () => ({
  ConfirmDialog: ({
    title,
    description,
    confirmLabel,
    onCancel,
    onConfirm,
  }: {
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
  }) => (
    <div role="dialog" aria-label={title}>
      <button onClick={onCancel}>Cancel {title}</button>
      <button onClick={onConfirm}>{confirmLabel}</button>
      {description}
    </div>
  ),
}));
vi.mock('@/components/league-court-assignment-dialog', () => ({
  LeagueCourtAssignmentDialog: ({
    onClose,
    onMoveLeaguePairToCourt,
    onUnassignLeaguePair,
    onSaveLeagueCourtAssignments,
  }: {
    onClose: () => void;
    onMoveLeaguePairToCourt: (id: string, court: number, session: number) => void;
    onUnassignLeaguePair: (id: string, session: number) => void;
    onSaveLeagueCourtAssignments: () => void;
  }) => (
    <div role="dialog" aria-label="Court assignment dialog">
      <button onClick={onClose}>Close court assignments</button>
      <button onClick={() => onMoveLeaguePairToCourt('pair-1', 2, 1)}>Move pair</button>
      <button onClick={() => onUnassignLeaguePair('pair-1', 1)}>Unassign pair</button>
      <button onClick={onSaveLeagueCourtAssignments}>Save court assignments</button>
    </div>
  ),
}));
vi.mock('@/components/interac-payment-instructions-dialog', () => ({
  InteracPaymentInstructionsDialog: ({
    notice,
    onClose,
  }: {
    notice: unknown;
    onClose: () => void;
  }) =>
    notice ? (
      <div role="dialog" aria-label="Interac instructions">
        <button onClick={onClose}>Close Interac</button>
      </div>
    ) : null,
}));

type DialogProps = ComponentProps<typeof TournamentPublicViewDialogs>;

function props(overrides: Record<string, unknown> = {}): DialogProps {
  return {
    court: {
      leagueCourtModalOpen: false,
      setLeagueCourtModalOpen: vi.fn(),
      leagueCourtSaving: false,
      leagueCourtDraft: [],
      setLeagueCourtDraft: vi.fn(),
      leagueCourtSessionCount: 1,
      setLeagueCourtSessionCount: vi.fn(),
      leagueCourtError: '',
      leagueCourtConfirmation: false,
      setLeagueCourtConfirmation: vi.fn(),
      courtTotal: 2,
      leagueCourtWarnings: [],
      openLeagueCourtModal: vi.fn(),
      moveLeaguePairToCourt: vi.fn(),
      unassignLeaguePair: vi.fn(),
      saveLeagueCourtAssignments: vi.fn(),
      leaguePairs: [],
    },
    leagueWithdrawTarget: null,
    leagueWithdrawError: '',
    leagueWithdrawBusy: false,
    setLeagueWithdrawTarget: vi.fn(),
    setLeagueWithdrawError: vi.fn(),
    confirmLeagueTeamWithdrawal: vi.fn(),
    withdrawTarget: null,
    withdrawEntry: undefined,
    withdrawPaidTeam: false,
    withdrawError: '',
    withdrawBusy: false,
    setWithdrawTarget: vi.fn(),
    setWithdrawError: vi.fn(),
    confirmTournamentWithdrawal: vi.fn(),
    interacNotice: null,
    setInteracNotice: vi.fn(),
    ...overrides,
  } as unknown as DialogProps;
}

describe('TournamentPublicViewDialogs', () => {
  it('renders no conditional dialogs when all actions are inactive', () => {
    render(<TournamentPublicViewDialogs {...props()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders court, withdrawal, warning, and Interac dialogs when requested', () => {
    const court = {
      ...props().court,
      leagueCourtModalOpen: true,
      leagueCourtConfirmation: true,
      leagueCourtWarnings: [{ session: 2, court: 3, count: 3 }],
      leagueCourtSaving: true,
    };
    const state = props({
      court,
      leagueWithdrawTarget: { participantId: 'p1', partnerParticipantId: 'p2' },
      leagueWithdrawError: 'Cannot withdraw',
      leagueWithdrawBusy: true,
      withdrawTarget: 'entry-1',
      withdrawEntry: { id: 'entry-1' },
      withdrawPaidTeam: true,
      withdrawError: 'Payment needs review',
      withdrawBusy: true,
      interacNotice: { amountCents: 5000 },
    });
    render(<TournamentPublicViewDialogs {...state} />);

    expect(screen.getByRole('dialog', { name: 'Court assignment dialog' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Withdraw your League team?' })).toHaveTextContent(
      'Cannot withdraw',
    );
    expect(
      screen.getByRole('dialog', { name: 'Withdraw this event registration?' }),
    ).toHaveTextContent('whole team');
    expect(screen.getByRole('dialog', { name: 'Court assignment warnings' })).toHaveTextContent(
      'Sub-session 2, Court 3 has 3 teams (6 player places; maximum 4).',
    );
    expect(screen.getByRole('dialog', { name: 'Interac instructions' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close court assignments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move pair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unassign pair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save court assignments' }));
    expect(court.setLeagueCourtModalOpen).toHaveBeenCalledWith(false);
    expect(court.moveLeaguePairToCourt).toHaveBeenCalledWith('pair-1', 2, 1);
    expect(court.unassignLeaguePair).toHaveBeenCalledWith('pair-1', 1);
    expect(court.saveLeagueCourtAssignments).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Withdraw your League team?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw team' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel Withdraw this event registration?' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Court assignment warnings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Interac' }));
    expect(court.setLeagueCourtConfirmation).toHaveBeenCalledWith(false);
    expect(court.saveLeagueCourtAssignments).toHaveBeenCalledWith(true);
    expect(state.setInteracNotice).toHaveBeenCalledWith(null);
  });

  it('uses the individual withdrawal description and hides optional errors', () => {
    render(
      <TournamentPublicViewDialogs
        {...props({
          withdrawTarget: 'entry-1',
          withdrawEntry: { id: 'entry-1' },
        })}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Withdraw this event registration?' }),
    ).toHaveTextContent('This will withdraw your registration from the event.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
