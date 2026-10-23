import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1' } as null | { id: string },
  profile: { role: 'member', application_status: 'approved' },
  paid: false,
  albums: [
    {
      id: 'public-album',
      title: 'Public Day',
      description: 'Public photos',
      visibility: 'public',
      created_at: '2026-01-01',
    },
    {
      id: 'member-album',
      title: 'Member Day',
      description: 'Members only',
      visibility: 'members',
      created_at: '2026-02-01',
    },
  ],
  photos: [
    {
      id: 'photo-1',
      album_id: 'public-album',
      storage_path: 'photo-1.jpg',
      caption: 'Public rally',
      alt_text: 'Rally',
      sort_order: 1,
    },
    {
      id: 'photo-2',
      album_id: 'member-album',
      storage_path: 'photo-2.jpg',
      caption: 'Member rally',
      alt_text: 'Private rally',
      sort_order: 1,
    },
  ],
  albumError: null as null | { message: string },
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: async () => ({ data: mocks.paid, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed.example/${path}` },
          error: null,
        }),
      }),
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: mocks.profile, error: null }),
        then: (
          resolve: (value: { data: unknown[]; error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(
            table === 'gallery_albums'
              ? { data: mocks.albums, error: mocks.albumError }
              : { data: mocks.photos, error: null },
          ).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));

import GalleryPage from '@/app/gallery/page';

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.profile = { role: 'member', application_status: 'approved' };
  mocks.paid = false;
  mocks.albumError = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GalleryPage', () => {
  it('shows only public albums to never-paid members and signs visible photo URLs', async () => {
    render(<GalleryPage />);
    expect(await screen.findByText('Public Day')).toBeInTheDocument();
    expect(screen.queryByText('Member Day')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rally Public rally' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Private rally' })).not.toBeInTheDocument();
  });

  it('allows paid members to open a photo viewer and wrap previous/next navigation', async () => {
    mocks.paid = true;
    const user = userEvent.setup();
    render(<GalleryPage />);
    await user.click(await screen.findByRole('button', { name: 'Rally Public rally' }));
    const viewer = within(screen.getByRole('dialog', { name: 'Photo viewer' }));
    expect(viewer.getByAltText('Rally')).toHaveAttribute(
      'src',
      'https://signed.example/photo-1.jpg',
    );
    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(viewer.getByAltText('Private rally')).toHaveAttribute(
      'src',
      'https://signed.example/photo-2.jpg',
    );
    await user.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(viewer.getByAltText('Rally')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close photo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a load error and an empty album state', async () => {
    mocks.albumError = { message: 'database unavailable' };
    const { unmount } = render(<GalleryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Gallery could not be loaded');
    unmount();
    mocks.albumError = null;
    mocks.albums = [];
    render(<GalleryPage />);
    await waitFor(() =>
      expect(screen.getByText('No published albums are available yet.')).toBeInTheDocument(),
    );
  });
});
