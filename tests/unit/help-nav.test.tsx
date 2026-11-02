import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpNav } from '@/components/help-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/help' }));

afterEach(cleanup);

describe('Help navigation', () => {
  it('hides the secondary navigation for public visitors', () => {
    const { container } = render(<HelpNav role={null} approved={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the guides the current role can access', () => {
    const { rerender } = render(<HelpNav role="member" approved />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Public guide' })).toHaveAttribute(
      'href',
      '/help/public',
    );
    expect(screen.getByRole('link', { name: 'Member guide' })).toHaveAttribute(
      'href',
      '/help/member',
    );

    rerender(<HelpNav role="organizer" approved />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Organizer guide' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Member guide' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin guide' })).not.toBeInTheDocument();

    rerender(<HelpNav role="admin" approved />);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Admin guide' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organizer guide' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Member guide' })).toBeInTheDocument();
  });
});
