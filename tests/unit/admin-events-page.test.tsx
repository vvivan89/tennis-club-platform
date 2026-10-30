import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  role: 'admin',
  events: [
    {
      id: 'event-1',
      slug: 'doubles-open',
      title: 'Doubles Open',
      starts_at: '2027-06-01T18:00:00Z',
      ends_at: '2027-06-01T20:00:00Z',
      status: 'published',
      capacity: 16,
      price_cents: 1500,
      series_id: null,
      created_by: 'admin-1',
      organizer_id: 'admin-1',
      event_type: 'tournament',
      tournament_format: 'doubles',
    },
  ],
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'or', 'order']) query[method] = () => query;
      query.maybeSingle = async () => ({
        data:
          table === 'profiles'
            ? { role: mocks.role }
            : { club_name: 'PCTC', short_name: 'PCTC', social_links: [] },
        error: null,
      });
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: table === 'events' ? mocks.events : [], error: null }).then(
          resolve,
          reject,
        );
      return query;
    },
  }),
}));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));

import EventsAdminPage from '@/app/admin/events/page';

afterEach(() => cleanup());

describe('admin events page', () => {
  it('loads event type and tournament format and renders the searchable filtered table', async () => {
    const page = await EventsAdminPage();
    render(page);
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Doubles tournament' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search events by name')).toBeInTheDocument();
  });

  it('redirects anonymous users to login', async () => {
    mocks.user = null;
    await expect(EventsAdminPage()).rejects.toThrow('redirect:/login?next=/admin/events');
    mocks.user = { id: 'admin-1' };
  });
});
