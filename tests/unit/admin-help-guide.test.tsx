import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminHelpGuide } from '@/components/help-guides/admin-guide';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/help/admin');
});

describe('AdminHelpGuide', () => {
  it('shows portal-aligned tabs and opens the selected guide section', async () => {
    const user = userEvent.setup();
    render(<AdminHelpGuide />);

    const tabs = within(screen.getByRole('tablist', { name: 'Admin help sections' }));
    expect(tabs.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Dashboard',
      'Club Profile',
      'Membership',
      'Payments',
      'Events',
      'Tournaments',
      'Publications',
      'Documents',
      'Audit Logs',
    ]);
    expect(
      screen.getByRole('heading', { name: 'Use the club-wide dashboard' }),
    ).toBeInTheDocument();

    await user.click(tabs.getByRole('tab', { name: 'Membership' }));
    expect(
      screen.getByRole('heading', { name: 'Understand family invitations, waivers, and payment' }),
    ).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('membership');
    expect(tabs.getByRole('tab', { name: 'Membership' })).toHaveAttribute('aria-selected', 'true');
  });

  it('documents event type configuration and visibility separately', async () => {
    const user = userEvent.setup();
    render(<AdminHelpGuide />);
    await user.click(screen.getByRole('tab', { name: 'Events' }));

    expect(
      screen.getByRole('heading', { name: 'Choose the right event type' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Single event schedule' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Series of events schedule' })).toBeInTheDocument();
    expect(screen.getAllByText(/Social Doubles Ladder/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Configure a Party' })).toBeInTheDocument();
    expect(
      screen.getByText(/Party events are only visible to approved members/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Configure a Team tournament' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Show overall results/)).toBeInTheDocument();
  });

  it('documents tournament entry, draw, scheduling, standings, and winner workflows', async () => {
    const user = userEvent.setup();
    render(<AdminHelpGuide />);
    await user.click(screen.getByRole('tab', { name: 'Tournaments' }));

    expect(
      screen.getByRole('heading', {
        name: 'Add tournament participants and correct entry details',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/never mark an unverified payment as paid/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How automated draws work' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'How automated match scheduling works' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Group standings, tie-breaks, and promotions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Review and announce tournament winners' }),
    ).toBeInTheDocument();
  });

  it('documents event editing, replacement, court assignment, and ladder courts', async () => {
    const user = userEvent.setup();
    render(<AdminHelpGuide />);
    await user.click(screen.getByRole('tab', { name: 'Events' }));
    expect(
      screen.getByRole('heading', { name: 'Edit events and manage participants' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Replace an event participant carefully' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Assign courts for a regular event' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Automatic ladder assignment calculates current Ladder standings/),
    ).toBeInTheDocument();
  });

  it('explains why audit history matters and distinguishes errors from business changes', async () => {
    const user = userEvent.setup();
    render(<AdminHelpGuide />);
    await user.click(screen.getByRole('tab', { name: 'Audit Logs' }));

    expect(
      screen.getByText(
        /affect real people’s access, payments, registrations, and competition records/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Application errors view is different/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Application errors: tracing and fixing bugs' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/correlation ID to connect this record/)).toBeInTheDocument();
    expect(screen.getByText(/Logs are read-only evidence/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Audit Logs' })).toHaveAttribute(
      'href',
      '/admin/audit-logs',
    );
  });

  it('warns that broad email announcement audiences ignore profile preferences', async () => {
    const user = userEvent.setup();
    render(<AdminHelpGuide />);
    await user.click(screen.getByRole('tab', { name: 'Publications' }));

    expect(
      screen.getByText(
        /sends the announcement regardless of each recipient’s email profile preferences/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/only for the most important information/i)).toBeInTheDocument();
  });

  it('explains the purpose of uploaded member documents', async () => {
    const user = userEvent.setup();
    render(<AdminHelpGuide />);
    await user.click(screen.getByRole('tab', { name: 'Documents' }));

    expect(
      screen.getByText(/share club bylaws, meeting minutes, and other documents with members/i),
    ).toBeInTheDocument();
  });

  it('loads a guide tab directly from the URL query parameter', async () => {
    window.history.replaceState({}, '', '/help/admin?tab=payments');
    render(<AdminHelpGuide />);
    expect(await screen.findByRole('tab', { name: 'Payments' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await screen.findByRole('heading', { name: 'How Stripe card payments are processed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Read Stripe’s Checkout fulfillment documentation' }),
    ).toHaveAttribute('href', 'https://docs.stripe.com/checkout/fulfillment');
  });
});
