import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';

const options: MemberOption[] = [
  { id: 'ada', full_name: 'Ada Lovelace', email: 'ada@example.com' },
  {
    id: 'grace',
    full_name: 'Grace Hopper',
    email: 'grace@example.com',
    available: false,
    unavailableReason: 'Already registered',
  },
];

describe('SearchableMemberSelect', () => {
  it('filters options by member name and email', () => {
    render(<SearchableMemberSelect options={options} value="" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'grace@' } });

    expect(screen.getByRole('option', { name: /Grace Hopper/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ada Lovelace/ })).not.toBeInTheDocument();
  });

  it('calls onChange when an available member is selected', () => {
    const onChange = vi.fn();
    render(<SearchableMemberSelect options={options} value="" onChange={onChange} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /Ada Lovelace/ }));

    expect(onChange).toHaveBeenCalledWith('ada');
  });

  it('disables unavailable members', () => {
    render(<SearchableMemberSelect options={options} value="" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: /Grace Hopper/ })).toBeDisabled();
    expect(screen.getByText('Already registered')).toBeInTheDocument();
  });
});
