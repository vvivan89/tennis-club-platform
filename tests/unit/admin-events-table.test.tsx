import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AdminEventsTable } from '@/components/admin-events-table';

const events = [
  {
    id: '1',
    slug: 'social-night',
    title: 'Friday Social',
    starts_at: '2027-06-01T18:00:00Z',
    ends_at: null,
    status: 'published',
    capacity: 20,
    price_cents: 0,
    series_id: null,
    event_type: 'social',
    tournament_format: null,
  },
  {
    id: '2',
    slug: 'doubles-open',
    title: 'Doubles Open',
    starts_at: '2027-07-01T18:00:00Z',
    ends_at: null,
    status: 'draft',
    capacity: 16,
    price_cents: 1500,
    series_id: null,
    event_type: 'tournament',
    tournament_format: 'doubles',
  },
  {
    id: '3',
    slug: 'team-cup',
    title: 'Team Cup',
    starts_at: '2027-08-01T18:00:00Z',
    ends_at: null,
    status: 'published',
    capacity: 32,
    price_cents: 2000,
    series_id: 'series-1',
    event_type: 'tournament',
    tournament_format: 'team',
  },
];

describe('admin event list filters', () => {
  it('shows type and supports name, type, price, status and date filtering', () => {
    render(<AdminEventsTable events={events} />);
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search events by name'), {
      target: { value: 'Doubles' },
    });
    expect(screen.getByText('Doubles Open')).toBeInTheDocument();
    expect(screen.queryByText('Friday Social')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search events by name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'team' } });
    expect(screen.getByText('Team Cup')).toBeInTheDocument();
    expect(screen.queryByText('Doubles Open')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Filter by price'), { target: { value: 'free' } });
    expect(screen.getByText('Friday Social')).toBeInTheDocument();
    expect(screen.queryByText('Team Cup')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by price'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'draft' } });
    expect(screen.getByText('Doubles Open')).toBeInTheDocument();
    expect(screen.queryByText('Friday Social')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Start date from'), { target: { value: '2027-07-01' } });
    expect(screen.getByText('Doubles Open')).toBeInTheDocument();
    expect(screen.queryByText('Friday Social')).not.toBeInTheDocument();
  });
});
