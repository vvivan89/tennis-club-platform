import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingTournamentInvitations } from '@/components/pending-tournament-invitations';

const mocks = vi.hoisted(() => ({
  state: { approved: true, isAdmin: false, isOrganizer: false },
  invitations: [] as Array<{
    participantId: string;
    participantName: string;
    eventId: string;
    eventSlug: string | null;
    eventTitle: string;
    startsAt: string;
  }>,
  useInvitations: vi.fn(),
}));

vi.mock('@/components/site-header-state', () => ({
  useSiteHeaderState: () => mocks.state,
}));
vi.mock('@/components/use-pending-tournament-invitations', () => ({
  usePendingTournamentInvitations: (enabled: boolean) => {
    mocks.useInvitations(enabled);
    return mocks.invitations;
  },
}));

afterEach(() => {
  cleanup();
  mocks.state = { approved: true, isAdmin: false, isOrganizer: false };
  mocks.invitations = [];
  mocks.useInvitations.mockClear();
});

describe('PendingTournamentInvitations', () => {
  it('hides the panel when there are no invitations and disables lookups for privileged roles', () => {
    const { rerender } = render(<PendingTournamentInvitations />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(mocks.useInvitations).toHaveBeenLastCalledWith(true);

    mocks.state = { approved: true, isAdmin: true, isOrganizer: false };
    rerender(<PendingTournamentInvitations />);
    expect(mocks.useInvitations).toHaveBeenLastCalledWith(false);

    mocks.state = { approved: false, isAdmin: false, isOrganizer: true };
    rerender(<PendingTournamentInvitations />);
    expect(mocks.useInvitations).toHaveBeenLastCalledWith(false);
  });

  it('lists pending invitations with confirmation links and dates', () => {
    mocks.invitations = [
      {
        participantId: 'entry 1',
        participantName: 'Alex Player',
        eventId: 'event-1',
        eventSlug: 'summer-open',
        eventTitle: 'Summer Open',
        startsAt: '2026-11-03T12:00:00.000Z',
      },
      {
        participantId: 'entry-2',
        participantName: 'Jordan Player',
        eventId: 'event-2',
        eventSlug: null,
        eventTitle: 'Winter Cup',
        startsAt: '2026-12-03T12:00:00.000Z',
      },
    ];
    render(<PendingTournamentInvitations />);

    expect(
      screen.getByRole('heading', { name: 'Tournament invitations awaiting your confirmation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Summer Open' })).toHaveAttribute(
      'href',
      '/events/summer-open?confirm_partner=entry%201',
    );
    expect(screen.getByRole('link', { name: 'Winter Cup' })).toHaveAttribute(
      'href',
      '/events/event-2?confirm_partner=entry-2',
    );
    expect(
      screen.getByText(new Date('2026-11-03T12:00:00.000Z').toLocaleDateString()),
    ).toBeInTheDocument();
  });
});
