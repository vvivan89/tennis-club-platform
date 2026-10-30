import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTournamentOrganizerContacts } from '@/components/public-tournament-organizer-contacts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PublicTournamentOrganizerContacts', () => {
  it('loads contacts on demand, renders links, and reuses the loaded response', async () => {
    let resolveFetch:
      ((response: { ok: boolean; json: () => Promise<unknown> }) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<PublicTournamentOrganizerContacts eventId="event/id" />);

    await user.click(screen.getByRole('button', { name: 'Show contacts' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading contacts');
    resolveFetch?.({
      ok: true,
      json: async () => ({
        contacts: [
          {
            organizer_name: 'Alex Organizer',
            position: 'Tournament director',
            emails: ['alex@example.com'],
            phones: ['604-555-0100'],
          },
        ],
      }),
    });
    expect(await screen.findByText('Alex Organizer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alex@example.com' })).toHaveAttribute(
      'href',
      'mailto:alex@example.com',
    );
    expect(screen.getByRole('link', { name: '604-555-0100' })).toHaveAttribute(
      'href',
      'tel:604-555-0100',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/events/event%2Fid/organizer-contacts', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    await user.click(screen.getByRole('button', { name: 'Close organizer contacts' }));
    await user.click(screen.getByRole('button', { name: 'Show contacts' }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('shows an empty state and closes when the backdrop is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contacts: [] }) }),
    );
    const user = userEvent.setup();
    render(<PublicTournamentOrganizerContacts eventId="event-1" />);
    await user.click(screen.getByRole('button', { name: 'Show contacts' }));
    expect(
      await screen.findByText('No organizer contact details are available.'),
    ).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    await user.click(dialog.parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows API and network errors and allows retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Contacts unavailable.' }),
      })
      .mockRejectedValueOnce('network down')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ contacts: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<PublicTournamentOrganizerContacts eventId="event-1" />);

    await user.click(screen.getByRole('button', { name: 'Show contacts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Contacts unavailable.');
    await user.click(screen.getByRole('button', { name: 'Show contacts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load organizer contacts.',
    );
    await user.click(screen.getByRole('button', { name: 'Show contacts' }));
    expect(
      await screen.findByText('No organizer contact details are available.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
