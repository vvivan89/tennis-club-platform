import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PublicHelpGuide } from '@/components/help-guides/public-guide';
import { AdminMembershipGuide } from '@/components/help-guides/admin/membership-guide';
import { AdminTournamentsGuide } from '@/components/help-guides/admin/tournaments-guide';

describe('underage player help topics', () => {
  it('explains guardian contact requirements to public account holders and guest registrants', () => {
    render(<PublicHelpGuide />);
    expect(screen.getByText(/If the birthdate shows you are under 18/)).toBeInTheDocument();
    expect(screen.getByText(/Date of birth and guardian contacts/)).toBeInTheDocument();
  });

  it('explains guardian collection on invitations and the tournament contact badge to admins', () => {
    render(
      <>
        <AdminMembershipGuide />
        <AdminTournamentsGuide />
      </>,
    );
    expect(screen.getByText(/Parent\/legal guardian contacts/)).toBeInTheDocument();
    const tournamentEntries = screen.getByRole('heading', {
      name: 'Add tournament participants and correct entry details',
    }).parentElement;
    expect(tournamentEntries).not.toBeNull();
    expect(within(tournamentEntries as HTMLElement).getByText(/Under 18/)).toBeInTheDocument();
  });
});
