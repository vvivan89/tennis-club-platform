import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UnderagePlayerBadge } from '@/components/underage-player-badge';

describe('UnderagePlayerBadge', () => {
  it('opens a modal with all recorded guardian names and contacts', () => {
    render(
      <UnderagePlayerBadge
        playerName="Taylor Player"
        age={14}
        guardians={[
          { name: 'Morgan Parent', email: 'morgan@example.test', phone: '604-555-0101' },
          { name: 'Alex Guardian', email: null, phone: '604-555-0102' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Underage player, age 14/ }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Parent/legal guardian contacts for Taylor Player',
    );
    expect(screen.getByText('Morgan Parent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'morgan@example.test' })).toHaveAttribute(
      'href',
      'mailto:morgan@example.test',
    );
    expect(screen.getByRole('link', { name: '604-555-0101' })).toHaveAttribute(
      'href',
      'tel:604-555-0101',
    );
    expect(screen.getByText('Alex Guardian')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
