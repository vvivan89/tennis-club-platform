import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventManagementForm } from '@/components/event-management-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('EventManagementForm organizer assignment', () => {
  const organizerOptions = [
    { id: 'admin-1', full_name: 'Alex Admin', email: 'alex@example.com', role: 'admin' },
    {
      id: 'organizer-1',
      full_name: 'Jordan Organizer',
      email: 'jordan@example.com',
      role: 'organizer',
    },
  ];

  it('defaults the admin-created event to the current administrator', () => {
    render(
      <EventManagementForm
        currentUserId="admin-1"
        organizerOptions={organizerOptions}
        showOrganizerField
      />,
    );

    const organizer = screen.getByLabelText('Organizer') as HTMLSelectElement;
    expect(organizer.value).toBe('admin-1');
    expect(
      screen.getByRole('option', { name: 'Jordan Organizer (organizer)' }),
    ).toBeInTheDocument();
  });

  it('does not render an organizer selector when the caller is an organizer', () => {
    render(<EventManagementForm currentUserId="organizer-1" />);
    expect(screen.queryByLabelText('Organizer')).not.toBeInTheDocument();
  });
});
