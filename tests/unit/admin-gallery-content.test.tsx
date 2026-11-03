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
  updateError: null as null | { message: string },
  deleteError: null as null | { message: string },
  storageError: null as null | { message: string },
  uploadError: null as null | { message: string },
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
            error:
              operation === 'insert'
                ? mocks.insertError
                : operation === 'update'
                  ? mocks.updateError
                  : operation === 'delete'
                    ? mocks.deleteError
                    : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from: () => ({
        upload: async (path: string, file: File, options: Record<string, unknown>) => {
          mocks.uploaded.push({ path, file, options });
          return { error: mocks.uploadError };
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
  mocks.updateError = null;
  mocks.deleteError = null;
  mocks.storageError = null;
  mocks.uploadError = null;
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

  it('reports album creation errors and supports album publication and visibility updates', async () => {
    mocks.insertError = { message: 'album insert failed' };
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await user.type(screen.getByLabelText('Album title'), 'New album');
    fireEvent.submit(screen.getByLabelText('Album title').closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create album.');

    mocks.insertError = null;
    const album = screen.getByRole('article');
    const published = within(album).getByLabelText('Published');
    await user.click(published);
    await user.selectOptions(within(album).getByLabelText('Visibility'), 'public');
    await waitFor(() => expect(mocks.updates).toHaveLength(2));
    expect(mocks.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'gallery_albums', values: { is_published: true } }),
        expect.objectContaining({ table: 'gallery_albums', values: { visibility: 'public' } }),
      ]),
    );
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

  it('rejects invalid image types and reports storage upload failures', async () => {
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await screen.findByText('Summer league');
    await user.selectOptions(screen.getByLabelText('Album'), 'album-1');
    fireEvent.change(document.getElementById('gallery-files') as HTMLInputElement, {
      target: { files: [new File(['not an image'], 'notes.txt', { type: 'text/plain' })] },
    });
    await user.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload photos');
    expect(mocks.uploaded).toHaveLength(0);

    mocks.uploadError = { message: 'storage unavailable' };
    fireEvent.change(document.getElementById('gallery-files') as HTMLInputElement, {
      target: { files: [new File(['image'], 'court.png', { type: 'image/png' })] },
    });
    await user.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload photos');
    expect(mocks.uploaded).toHaveLength(1);
  });

  it('validates album uploads and rolls back stored files when photo metadata insertion fails', async () => {
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await screen.findByText('Summer league');
    fireEvent.submit(screen.getByLabelText('Album').closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose an album and at least one image',
    );

    await user.selectOptions(screen.getByLabelText('Album'), 'album-1');
    await user.upload(
      document.getElementById('gallery-files') as HTMLInputElement,
      new File(['image'], 'court.webp', { type: 'image/webp' }),
    );
    mocks.insertError = { message: 'metadata unavailable' };
    await user.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload photos');
    expect(mocks.removedPaths).toHaveLength(1);
  });

  it('confirms album deletion and removes its stored photos before deleting metadata', async () => {
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await user.click(await screen.findByRole('button', { name: 'Upload to this album' }));
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

  it('updates photo captions and reports failures while deleting a photo', async () => {
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await screen.findByText('Summer league');
    const caption = screen.getByLabelText('Caption');
    fireEvent.blur(caption);
    expect(mocks.updates).toHaveLength(0);
    await user.clear(caption);
    await user.type(caption, 'Championship day');
    fireEvent.blur(caption);
    await waitFor(() =>
      expect(mocks.updates).toContainEqual(
        expect.objectContaining({
          table: 'gallery_photos',
          values: { caption: 'Championship day' },
        }),
      ),
    );

    mocks.storageError = { message: 'storage unavailable' };
    await user.click(screen.getByRole('button', { name: 'Delete photo' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete photo.');
    expect(mocks.inserted).not.toContainEqual(
      expect.objectContaining({ table: 'gallery_photos.delete' }),
    );
  });

  it('does not request storage cleanup for photo-free albums and reports album delete failures', async () => {
    mocks.photos = [];
    mocks.deleteError = { message: 'database delete failed' };
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await user.click(await screen.findByRole('button', { name: 'Delete album' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete album.');
    expect(mocks.removedPaths).toHaveLength(0);
  });

  it('reports album and caption update errors without changing saved metadata', async () => {
    mocks.updateError = { message: 'update denied' };
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await screen.findByText('Summer league');
    const album = screen.getByRole('article');
    await user.click(within(album).getByLabelText('Published'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update album.');

    await user.clear(screen.getByLabelText('Caption'));
    await user.type(screen.getByLabelText('Caption'), 'Changed');
    fireEvent.blur(screen.getByLabelText('Caption'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update photo caption.');
  });

  it('reports photo metadata deletion errors after its stored image is removed', async () => {
    mocks.deleteError = { message: 'photo row deletion failed' };
    const user = userEvent.setup();
    render(<AdminGalleryContent embedded />);
    await user.click(await screen.findByRole('button', { name: 'Delete photo' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete photo.');
    expect(mocks.removedPaths).toContain('album-1/final.jpg');
  });
});
