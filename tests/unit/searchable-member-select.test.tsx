import { describe, expect, it, vi } from 'vitest';
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

  it('filters case-insensitively, sorts eligible options first, and selects an option', () => {
    const onChange = vi.fn();
    render(
      <SearchableMemberSelect
        value=""
        onChange={onChange}
        options={[
          { id: 'unavailable', full_name: 'Alex Player', available: false, sortPriority: 3 },
          { id: 'later', full_name: 'Taylor Smith', sortPriority: 2 },
          { id: 'first', full_name: 'Taylor Jones', sortPriority: 1 },
        ]}
      />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
      'Taylor Jones',
      'Taylor Smith',
      'Alex Player',
    ]);
    fireEvent.change(input, { target: { value: 'TAYLOR' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.click(screen.getByRole('option', { name: 'Taylor Jones' }));
    expect(onChange).toHaveBeenCalledWith('first');
  });

  it('clears a current value when typing and shows fallback labels, skill, and empty search state', () => {
    const onChange = vi.fn();
    render(
      <SearchableMemberSelect
        value="member"
        onChange={onChange}
        options={[
          { id: 'member', full_name: null, email: 'member@example.test', tennis_skill_level: 3 },
        ]}
      />,
    );
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('member@example.test');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByText('No matching members.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('option', { name: /Member 3/ })).toBeInTheDocument();
  });

  it('honors disabled state and displays status and unavailability descriptions separately', () => {
    render(
      <SearchableMemberSelect
        value=""
        onChange={() => undefined}
        disabled
        options={[
          {
            id: 'member',
            full_name: 'Member',
            statusText: 'Current status',
            unavailableReason: 'Not eligible',
            available: false,
          },
        ]}
      />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Current status')).toBeInTheDocument();
    expect(screen.getByText('Not eligible')).toBeInTheDocument();
  });
});
