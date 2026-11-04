import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpCenter } from '@/components/help-center';

afterEach(cleanup);

describe('Help Center role access', () => {
  it('shows public help without member or staff content', () => {
    render(<HelpCenter guide="public" />);
    expect(
      screen.queryByRole('heading', { name: 'Public and event visitors' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('For everyone')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Public event pages show the published event information/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Need help with a specific entry?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Browse an event and understand registration' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Register for a public doubles tournament' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Club-wide operations' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Build and run an event' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Your account, entries, and payments' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Approved members')).not.toBeInTheDocument();
  });

  it('renders member portal tabs and guide topics separately from public and staff content', () => {
    render(<HelpCenter guide="member" />);
    expect(
      screen.queryByRole('heading', { name: 'Your account, entries, and payments' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Member help sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: 'Dashboard and activity overview' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Public and event visitors' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Member help topics' }).closest('header'),
    ).toBeInTheDocument();
  });

  it('lists email preference subjects and distinguishes emails those preferences do not control', async () => {
    const user = userEvent.setup();
    render(<HelpCenter guide="member" />);
    await user.click(screen.getByRole('tab', { name: 'Profile' }));

    expect(
      screen.getByRole('heading', { name: 'Emails managed by these preferences' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Registration is open: \{event title\}/)).toBeInTheDocument();
    expect(screen.getByText(/Your place in a PCTC event is confirmed/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Other emails are not controlled by these preferences' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PCTC Interac payment instructions/)).toBeInTheDocument();
    expect(screen.getByText(/account invitations, passwordless sign-in links/)).toBeInTheDocument();
    expect(screen.getByText(/broad audiences.*ignore profile preferences/i)).toBeInTheDocument();
  });

  it('shows detailed membership, family, and payment workflows on their portal tab', async () => {
    const user = userEvent.setup();
    render(<HelpCenter guide="member" />);
    await user.click(screen.getByRole('tab', { name: 'Membership' }));

    expect(
      screen.getByRole('heading', { name: 'Season membership and your waiver' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Invite members to a family plan' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pay membership fees by card or Interac' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review payment history' })).toBeInTheDocument();
    expect(
      screen.getByText(/each adult family member accepts their own waiver/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/family checkout is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Interac is not automatically confirmed/i)).toBeInTheDocument();
  });

  it('documents member events, competition entry, captain lineups, and score correction', async () => {
    const user = userEvent.setup();
    render(<HelpCenter guide="member" />);
    await user.click(screen.getByRole('tab', { name: 'Events' }));
    expect(
      screen.getByRole('heading', { name: 'Register for an event or withdraw' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pay event fees by card or Interac' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Report scores for a club event' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The club must confirm receipt before the payment is marked paid/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A paid membership does not automatically pay an event fee/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Competitions' }));
    expect(screen.getByRole('heading', { name: 'Register for a tournament' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Register and pay with a partner' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Register for League events' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Join and play a Social Doubles Ladder' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Team tournament: captain match workflow' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/including yourself if you are playing/i)).toBeInTheDocument();
    expect(screen.getByText(/Use the pencil control on a saved result/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Tournament invitations awaiting your confirmation/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/for both partners to pay the combined amount/i)).toBeInTheDocument();
    expect(screen.getByText(/player who invited you/i)).toBeInTheDocument();
  });

  it('provides results, ranking, resource, and chat topics, with deep links to tabs', async () => {
    const user = userEvent.setup();
    render(<HelpCenter guide="member" />);
    const nav = screen.getByRole('navigation', { name: 'Member help topics' });
    expect(screen.getByRole('link', { name: 'Team tournament captain workflow' })).toHaveAttribute(
      'href',
      '?tab=competitions#member-team-captain',
    );
    expect(screen.getByRole('link', { name: 'Register and pay with a partner' })).toHaveAttribute(
      'href',
      '?tab=competitions#member-pair-registration',
    );
    await user.click(screen.getByRole('tab', { name: 'Results & rankings' }));
    expect(screen.getByRole('heading', { name: 'Read your Results page' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Use Rankings and competition standings' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Resources & chat' }));
    expect(screen.getByRole('heading', { name: 'Gallery and Documents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Member chat' })).toBeInTheDocument();
    expect(nav).toBeInTheDocument();
  });

  it('shows organizers only their applicable portal tabs and keeps admin content separate', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HelpCenter guide="organizer" />);
    expect(
      screen.queryByRole('heading', { name: 'Build and run an event' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Start in Organizer Portal or Admin Portal → Events/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Use the Organizer dashboard to triage events' }),
    ).toBeInTheDocument();
    const organizerTabs = screen.getByRole('tablist', { name: 'Organizer help sections' });
    expect(organizerTabs.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Organizer help topics' }).closest('header'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Events' }));
    expect(
      screen.getByRole('heading', { name: 'Choose the right event type' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Add tournament participants and correct entry details',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tournaments' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Tournaments' }));
    expect(
      screen.getByRole('heading', {
        name: 'Add tournament participants and correct entry details',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Automated draws' })).toHaveAttribute(
      'href',
      '?tab=tournaments#admin-tournament-automated-draw',
    );

    window.history.replaceState({}, '', '/help/admin');
    rerender(<HelpCenter guide="admin" />);
    expect(
      screen.queryByRole('heading', { name: 'Build and run an event' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Club-wide operations' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Use the club-wide dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Admin help sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tournaments' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Need help with a specific entry?' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'open Organizer guide' })).not.toBeInTheDocument();
  });

  it('shows admin topic chips in the shared header with a two-row preview', async () => {
    const { container } = render(<HelpCenter guide="admin" />);
    const topicsNav = screen.getByRole('navigation', { name: 'Admin help topics' });
    expect(topicsNav).toHaveClass('max-h-[4.5rem]');
    expect(
      container.querySelector('header nav[aria-label="Admin help topics"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View all' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await screen.getByRole('button', { name: 'View all' }).click();
    expect(topicsNav).not.toHaveClass('max-h-[4.5rem]');
    expect(screen.getByRole('button', { name: 'View less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    expect(screen.getByRole('link', { name: 'Membership plans' })).toHaveAttribute(
      'href',
      '?tab=membership#admin-membership-plans',
    );
    expect(screen.getByRole('link', { name: 'Automated draws' })).toHaveAttribute(
      'href',
      '?tab=tournaments#admin-tournament-automated-draw',
    );
    expect(screen.getByRole('link', { name: 'Assign event courts' })).toHaveAttribute(
      'href',
      '?tab=events#admin-event-courts',
    );
    expect(screen.getByRole('link', { name: 'Emails' })).toHaveAttribute(
      'href',
      '?tab=emails#admin-emails',
    );
  });
});
