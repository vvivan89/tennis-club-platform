import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  profile: { role: 'admin', application_status: 'approved' } as null | Record<string, unknown>,
  albums: [] as Array<Record<string, unknown>>,
  photos: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; id: string; values: Record<string, unknown> }>,
  removedPaths: [] as string[],
  uploaded: [] as Array<{ path: string; file: File; options: Record<string, unknown> }>,
  insertError: null as null | { message: string },
  storageError: null as null | { message: string },
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => {
  const router = { replace: mocks.routerReplace };
  return { useRouter: () => router };
});
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
    from: (table: string) => {
      let operation = 'select';
      let values: Record<string, unknown> = {};
      let id = '';
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          id = value;
          return query;
        },
        order: () => query,
        insert: (payload: Record<string, unknown>) => {
          operation = 'insert';
          values = payload;
          mocks.inserted.push({ table, values: payload });
          return query;
        },
        update: (payload: Record<string, unknown>) => {
          operation = 'update';
          values = payload;
          return query;
        },
        delete: () => {
          operation = 'delete';
          return query;
        },
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : null,
          error: null,
        }),
        single: async () => ({ data: { id: 'album-new' }, error: mocks.insertError }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (operation === 'update') mocks.updates.push({ table, id, values });
          if (operation === 'delete')
            mocks.inserted.push({ table: `${table}.delete`, values: { id } });
          const data =
            table === 'gallery_albums'
              ? mocks.albums
              : table === 'gallery_photos'
                ? mocks.photos
                : [];
          return Promise.resolve({
            data,
            error: operation === 'insert' ? mocks.insertError : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from: () => ({
        upload: async (path: string, file: File, options: Record<string, unknown>) => {
          mocks.uploaded.push({ path, file, options });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          mocks.removedPaths.push(...paths);
          return { error: mocks.storageError };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed.example/${path}` },
          error: null,
        }),
      }),
    },
  }),
}));

import { AdminGalleryContent } from '@/components/admin-gallery-content';

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.albums = [
    {
      id: 'album-1',
      title: 'Summer league',
      description: 'Match photos',
      visibility: 'members',
      is_published: false,
      created_at: '2026-06-01T00:00:00Z',
    },
  ];
  mocks.photos = [
    {
      id: 'photo-1',
      album_id: 'album-1',
      storage_path: 'album-1/final.jpg',
      caption: 'Final day',
      alt_text: 'Final',
      sort_order: 1,
    },
  ];
  mocks.inserted = [];
  mocks.updates = [];
  mocks.removedPaths = [];
  mocks.uploaded = [];
  mocks.insertError = null;
  mocks.storageError = null;
  mocks.routerReplace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminGalleryContent', () => {
  it('redirects signed-out and non-admin users', async () => {
    mocks.user = null;
    const { unmount } = render(<AdminGalleryContent embedded />);
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith('/login?next=/admin/website?tab=gallery'),
    );
    unmount();

    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    render(<AdminGalleryContent embedded />);
    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalledWith('/member/dashboard'));
    expect(screen.queryByText('Summer league')).not.toBeInTheDocument();
  });

  it('creates an unpublished members-only album with trimmed metadata', async () => {
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await user.type(screen.getByLabelText('Album title'), '  Winter clinic  ');
    await user.type(screen.getByLabelText('Description (optional)'), '  Youth photos  ');
    await user.selectOptions(screen.getAllByLabelText('Visibility')[0], 'members');
    await user.click(screen.getByLabelText('Publish album immediately'));
    fireEvent.submit(screen.getByLabelText('Album title').closest('form') as HTMLFormElement);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Album created. Upload photos below.',
    );
    expect(mocks.inserted).toContainEqual({
      table: 'gallery_albums',
      values: {
        title: 'Winter clinic',
        description: 'Youth photos',
        visibility: 'members',
        is_published: false,
        created_by: 'admin-1',
      },
    });
  });

  it('sanitizes photo paths and stores the original filename as accessible alt text', async () => {
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await screen.findByText('Summer league');
    await user.selectOptions(screen.getByLabelText('Album'), 'album-1');
    await user.upload(
      document.getElementById('gallery-files') as HTMLInputElement,
      new File(['image'], 'team photo!.webp', { type: 'image/webp' }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload 1 photo' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Photos uploaded.');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].path).toMatch(/^album-1\/[\w-]+-team_photo_.webp$/);
    expect(mocks.uploaded[0].options).toEqual({ contentType: 'image/webp', upsert: false });
    expect(mocks.inserted).toContainEqual({
      table: 'gallery_photos',
      values: expect.objectContaining({
        album_id: 'album-1',
        caption: '',
        alt_text: 'team photo!',
        uploaded_by: 'admin-1',
      }),
    });
  });

  it('confirms album deletion and removes its stored photos before deleting metadata', async () => {
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await user.click(await screen.findByRole('button', { name: 'Delete album' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete album “Summer league”');
    expect(mocks.removedPaths).toHaveLength(0);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() =>
      expect(mocks.inserted).toContainEqual({
        table: 'gallery_albums.delete',
        values: { id: 'album-1' },
      }),
    );
    expect(mocks.removedPaths).toEqual(['album-1/final.jpg']);
  });
});
