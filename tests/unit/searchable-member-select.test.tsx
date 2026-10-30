import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableMemberSelect } from '@/components/searchable-member-select';

describe('SearchableMemberSelect tournament player descriptions', () => {
  it('shows the player description on a second line and disables unavailable players', () => {
    render(
      <SearchableMemberSelect
        value=""
        onChange={() => undefined}
        options={[
          { id: 'available', full_name: 'Taylor Player', statusText: 'Eligible for mixed doubles' },
          {
            id: 'paired',
            full_name: 'Jordan Player',
            statusText: 'Already paired with Alex',
            available: false,
            unavailableReason: 'Already paired with Alex',
          },
        ]}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Eligible for mixed doubles')).toBeInTheDocument();
    expect(screen.getByText('Already paired with Alex')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Jordan Player/ })).toBeDisabled();
  });
});
