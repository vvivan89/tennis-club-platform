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
  photoError: null as null | { message: string },
  signedUrl: 'https://signed.example/photo.jpg' as null | string,
  clubSettings: null as null | Record<string, unknown>,
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    rpc: mocks.rpc,
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: mocks.signedUrl ? { signedUrl: mocks.signedUrl.replace('photo.jpg', path) } : null,
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
        maybeSingle: async () => ({
          data: table === 'club_settings' ? mocks.clubSettings : mocks.profile,
          error: null,
        }),
        then: (
          resolve: (value: { data: unknown[]; error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(
            table === 'gallery_albums'
              ? { data: mocks.albums, error: mocks.albumError }
              : { data: mocks.photos, error: mocks.photoError },
          ).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/site-header', () => ({
  SiteHeader: ({ clubName, shortName }: { clubName: string; shortName: string }) => (
    <div>
      {clubName} {shortName}
    </div>
  ),
}));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));

import GalleryPage from '@/app/gallery/page';

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.profile = { role: 'member', application_status: 'approved' };
  mocks.paid = false;
  mocks.albums = [
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
  ];
  mocks.photos = [
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
  ];
  mocks.albumError = null;
  mocks.photoError = null;
  mocks.signedUrl = 'https://signed.example/photo.jpg';
  mocks.clubSettings = null;
  mocks.rpc.mockReset().mockResolvedValue({ data: mocks.paid, error: null });
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

  it('applies admin and approved-member access rules and handles photo load failures', async () => {
    mocks.user = null;
    mocks.clubSettings = {
      club_name: 'Gallery Club',
      short_name: 'GC',
      social_links: 'not-an-array',
    };
    render(<GalleryPage />);
    expect(await screen.findByText(/Gallery Club/)).toBeInTheDocument();
    expect(screen.getByText('Public Day')).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();

    cleanup();
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'admin', application_status: 'approved' };
    render(<GalleryPage />);
    expect(await screen.findByText('Member Day')).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();

    cleanup();
    mocks.profile = { role: 'member', application_status: 'pending' };
    mocks.user = { id: 'pending-member' };
    render(<GalleryPage />);
    expect(await screen.findByText('Public Day')).toBeInTheDocument();
    expect(screen.queryByText('Member Day')).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();

    cleanup();
    mocks.profile = { role: 'member', application_status: 'approved' };
    mocks.paid = true;
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.photoError = { message: 'photo query failed' };
    render(<GalleryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Gallery could not be loaded');
    expect(mocks.rpc).toHaveBeenCalledWith('has_ever_paid_membership');
  });

  it('uses club defaults and renders albums with missing photos and descriptive fallbacks', async () => {
    mocks.user = null;
    mocks.clubSettings = { club_name: '', short_name: '', social_links: null };
    mocks.albums = [
      {
        id: 'empty',
        title: 'Empty album',
        description: '',
        visibility: 'public',
        created_at: '2026-03-01',
      },
      {
        id: 'without-image',
        title: 'Image unavailable',
        description: '',
        visibility: 'public',
        created_at: '2026-02-15',
      },
      {
        id: 'fallback',
        title: 'Fallback album',
        description: '',
        visibility: 'public',
        created_at: '2026-02-01',
      },
    ];
    mocks.photos = [
      {
        id: 'without-url',
        album_id: 'without-image',
        storage_path: 'missing.jpg',
        caption: '',
        alt_text: '',
        sort_order: 1,
      },
      {
        id: 'fallback-alt',
        album_id: 'fallback',
        storage_path: 'fallback.jpg',
        caption: 'A caption',
        alt_text: '',
        sort_order: 1,
      },
    ];
    mocks.signedUrl = null;
    const user = userEvent.setup();
    render(<GalleryPage />);

    expect(await screen.findByText(/Port Coquitlam Tennis Club/)).toBeInTheDocument();
    expect(screen.getByText(/PCTC/)).toBeInTheDocument();
    expect(screen.getByText('No photos in this album yet.')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Public album/).some((node) => node.textContent?.includes('0 photos')),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'A caption' })).toBeInTheDocument();

    mocks.signedUrl = 'https://signed.example/photo.jpg';
    cleanup();
    mocks.photos = [
      {
        id: 'fallback-alt',
        album_id: 'fallback',
        storage_path: 'fallback.jpg',
        caption: '',
        alt_text: '',
        sort_order: 1,
      },
    ];
    render(<GalleryPage />);
    expect(await screen.findByAltText('Fallback album')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fallback album' }));
    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();
  });
});
