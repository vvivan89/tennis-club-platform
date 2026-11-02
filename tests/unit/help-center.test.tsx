import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpCenter } from '@/components/help-center';

afterEach(cleanup);

describe('Help Center role access', () => {
  it('shows public help without member or staff content', () => {
    render(<HelpCenter guide="public" />);
    expect(screen.getByRole('heading', { name: 'Public and event visitors' })).toBeInTheDocument();
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
  });

  it('renders member topics separately from public and staff content', () => {
    render(<HelpCenter guide="member" />);
    expect(
      screen.getByRole('heading', { name: 'Your account, entries, and payments' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Set profile information that affects event entry' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Explore Club rankings and competition standings' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Use the Gallery and Documents sections' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Public and event visitors' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Your selected rating is shown next to your name/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Member chat: image, mention, and message controls' }),
    ).toBeInTheDocument();
  });

  it('renders separate organizer and admin guides', () => {
    const { rerender } = render(<HelpCenter guide="organizer" />);
    expect(screen.getByRole('heading', { name: 'Build and run an event' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Use the Organizer dashboard to triage events' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Club-wide operations' })).not.toBeInTheDocument();
    rerender(<HelpCenter guide="admin" />);
    expect(
      screen.queryByRole('heading', { name: 'Build and run an event' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Club-wide operations' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Read the Admin dashboard overview' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'How results become rankings and standings' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'open Organizer guide' })).toHaveAttribute(
      'href',
      '/help/organizer',
    );
  });
});
