import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
  singles: {} as Record<string, unknown>,
  signedUrls: [] as string[],
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}));

vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      mocks.queries.push({ table, filters });
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        gte: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: mocks.singles[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const albumId = filters.find(([column]) => column === 'album_id')?.[1];
          const key = table === 'gallery_photos' && albumId ? `${table}.${albumId}` : table;
          return Promise.resolve({
            data: mocks.rows[key] ?? [],
            error: mocks.errors[table] ?? null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: mocks.signedUrls.find((url) => url.includes(path)) ?? null },
          error: null,
        }),
      }),
    },
  }),
}));
vi.mock('@/components/site-header', () => ({
  SiteHeader: ({ clubName }: { clubName: string }) => <header>{clubName}</header>,
}));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/event-card-actions', () => ({ EventCardActions: () => null }));
vi.mock('@/components/event-card-weather', () => ({ EventCardWeather: () => null }));

import Home from '@/app/page';

beforeEach(() => {
  mocks.rows = {};
  mocks.errors = {};
  mocks.singles = {};
  mocks.signedUrls = [];
  mocks.queries = [];
});
afterEach(() => {
  cleanup();
});

describe('home page data', () => {
  it('keeps sample events visible when live event data is empty', async () => {
    mocks.errors.events = { message: 'offline' };
    render(<Home />);
    expect(await screen.findByText('Friday Social Tennis')).toBeInTheDocument();
    expect(screen.getByText('Fall Doubles Tournament')).toBeInTheDocument();
    expect(
      screen.getByText('Preview mode · Sample events shown · No live registrations or payments'),
    ).toBeInTheDocument();
    expect(mocks.queries.find((query) => query.table === 'gallery_albums')?.filters).toContainEqual(
      ['visibility', 'public'],
    );
  });

  it('renders live news, events, club details, and signed photos from public albums', async () => {
    mocks.rows.events = [
      {
        id: 'event-live',
        slug: 'autumn-social',
        title: 'Autumn Social',
        description: 'A club gathering',
        starts_at: '2026-10-24T18:00:00Z',
        registration_opens_at: '2026-10-01T00:00:00Z',
        registration_closes_at: null,
        capacity: 16,
        price_cents: 0,
        members_only: true,
        event_type: 'social',
        status: 'published',
        location: 'Main courts',
      },
    ];
    mocks.rows.news = [
      {
        id: 'news-1',
        title: 'Court Update',
        body: '<p>New court hours</p>',
        published_at: '2026-10-20T12:00:00Z',
      },
    ];
    mocks.rows.gallery_albums = [
      { id: 'album-1', title: 'Autumn Gallery', description: 'Club photos' },
    ];
    mocks.rows['gallery_photos.album-1'] = [
      { id: 'photo-1', storage_path: 'album-1/photo.jpg', caption: 'Team photo' },
      { id: 'photo-2', storage_path: 'album-1/no-url.jpg', caption: '' },
    ];
    mocks.singles.club_settings = {
      club_name: 'Port Coquitlam Tennis Club',
      short_name: 'PCTC',
      contact_email: 'info@example.com',
      contact_phone: '6045550100',
      location_url: 'https://maps.example/club',
      location_query: 'Port Coquitlam courts',
      social_links: [],
    };
    mocks.signedUrls = ['https://signed.example/album-1/photo.jpg'];

    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Autumn Social' })).toBeInTheDocument();
    expect(screen.getByText('Free for members')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Court Update' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read article' })).toHaveAttribute(
      'href',
      '/publications/court_update',
    );
    expect(screen.getByRole('link', { name: 'View Autumn Gallery gallery' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Team photo' })).toHaveAttribute(
        'src',
        'https://signed.example/album-1/photo.jpg',
      ),
    );
    expect(screen.getByText('Port Coquitlam Tennis Club')).toBeInTheDocument();
    expect(screen.queryByText(/Preview mode/)).not.toBeInTheDocument();
    expect(mocks.queries.find((query) => query.table === 'events')?.filters).toContainEqual([
      'status',
      'published',
    ]);
  });
});
