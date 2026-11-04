import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PendingTournamentInvitationBadge } from '@/components/pending-tournament-invitation-badge';

describe('PendingTournamentInvitationBadge', () => {
  it('hides an empty count and labels singular and plural invitation counts', () => {
    const { rerender } = render(<PendingTournamentInvitationBadge count={0} />);
    expect(screen.queryByLabelText(/pending tournament invitation/)).not.toBeInTheDocument();

    rerender(<PendingTournamentInvitationBadge count={1} />);
    expect(screen.getByLabelText('1 pending tournament invitation')).toHaveTextContent('1');

    rerender(<PendingTournamentInvitationBadge count={3} />);
    expect(screen.getByLabelText('3 pending tournament invitations')).toHaveTextContent('3');
  });
});
