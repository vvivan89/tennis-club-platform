import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminEventsTable } from '@/components/admin-events-table';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

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
    render(<AdminEventsTable events={[...events].reverse()} />);
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    const futureRows = screen.getAllByRole('row').slice(1);
    expect(futureRows[0]).toHaveTextContent('Friday Social');
    expect(futureRows[1]).toHaveTextContent('Doubles Open');
    expect(futureRows[2]).toHaveTextContent('Team Cup');
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

  it('filters past and ongoing events, labels Leagues and ladders, and respects the edit window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-03T12:00:00Z').getTime());
    const rows = [
      {
        ...events[0],
        id: 'ongoing',
        title: 'Ongoing',
        starts_at: '2026-11-03T10:00:00Z',
        ends_at: '2026-11-03T14:00:00Z',
      },
      {
        ...events[0],
        id: 'recent',
        title: 'Recent',
        starts_at: '2026-11-02T10:00:00Z',
        ends_at: '2026-11-02T14:00:00Z',
      },
      { ...events[0], id: 'old', title: 'Old', starts_at: '2026-10-01T10:00:00Z', ends_at: null },
      { ...events[1], id: 'league', title: 'League Event', is_league_tournament: true },
      { ...events[0], id: 'ladder', title: 'Club Ladder', event_type: 'ladder' },
    ];
    render(<AdminEventsTable events={rows} />);
    expect(screen.getByText('Ongoing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Ongoing' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'League' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Social doubles ladder' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Past events' }));
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Old')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit Old' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Recent' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by price'), { target: { value: 'paid' } });
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
  });

  it('confirms deletion, reports API errors, and refreshes the list after success', async () => {
    const refresh = vi.fn();
    router.refresh = refresh;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Delete blocked.' }), { status: 409 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AdminEventsTable events={events} />);
    await user.click(screen.getByRole('button', { name: 'Delete Friday Social' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('delete Friday Social');
    await user.click(
      screen.getByRole('alertdialog').querySelector('button:last-child') as HTMLButtonElement,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete blocked.');

    await user.click(screen.getByRole('button', { name: 'Delete Friday Social' }));
    await user.click(
      screen.getByRole('alertdialog').querySelector('button:last-child') as HTMLButtonElement,
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('Event deleted successfully.');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/events/1/delete', { method: 'DELETE' });
  });
});
