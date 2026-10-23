import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  profile: { role: 'admin', application_status: 'approved' } as null | Record<string, unknown>,
  documents: [] as Array<Record<string, unknown>>,
  insertError: null as null | { message: string },
  deleteError: null as null | { message: string },
  uploadError: null as null | { message: string },
  storageError: null as null | { message: string },
  inserted: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  uploaded: [] as Array<{ path: string; file: File; options: Record<string, unknown> }>,
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
      let payload: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        insert: (values: Record<string, unknown>) => {
          operation = 'insert';
          payload = values;
          mocks.inserted.push(values);
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
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const response =
            operation === 'insert'
              ? { error: mocks.insertError }
              : operation === 'delete'
                ? { error: mocks.deleteError }
                : { data: table === 'documents' ? mocks.documents : [], error: null };
          if (operation === 'delete') mocks.deleted.push(table);
          void payload;
          return Promise.resolve(response).then(resolve, reject);
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
          mocks.deleted.push(...paths);
          return { error: mocks.storageError };
        },
      }),
    },
  }),
}));

import { AdminDocumentsContent } from '@/components/admin-documents-content';

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.documents = [
    {
      id: 'doc-1',
      title: 'Club handbook',
      description: 'Current policies',
      storage_path: 'admin-1/handbook.pdf',
      created_at: '2026-01-01T00:00:00Z',
    },
  ];
  mocks.insertError = null;
  mocks.deleteError = null;
  mocks.uploadError = null;
  mocks.storageError = null;
  mocks.inserted = [];
  mocks.deleted = [];
  mocks.uploaded = [];
  mocks.routerReplace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminDocumentsContent', () => {
  it('redirects signed-out and unauthorized users without loading documents', async () => {
    mocks.user = null;
    const { unmount } = render(<AdminDocumentsContent embedded />);
    await waitFor(() =>
      expect(mocks.routerReplace).toHaveBeenCalledWith(
        '/login?next=/admin/documents?tab=uploaded_documents',
      ),
    );
    unmount();

    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    render(<AdminDocumentsContent embedded />);
    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalledWith('/member/dashboard'));
    expect(screen.queryByText('Club handbook')).not.toBeInTheDocument();
  });

  it('rejects non-PDF and oversized files before contacting storage', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<AdminDocumentsContent embedded />);
    const input = document.getElementById('document-pdf') as HTMLInputElement;
    await user.upload(input, new File(['text'], 'notes.txt', { type: 'text/plain' }));
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a PDF file.');
    expect(mocks.uploaded).toHaveLength(0);

    const oversized = new File(['pdf'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    await user.upload(input, oversized);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF must be 20 MB or smaller.');
    expect(mocks.uploaded).toHaveLength(0);
  });

  it('rolls back the uploaded PDF when document metadata insertion fails', async () => {
    mocks.insertError = { message: 'database unavailable' };
    const user = userEvent.setup();
    render(<AdminDocumentsContent embedded />);
    await screen.findByText('Club handbook');
    await user.upload(
      document.getElementById('document-pdf') as HTMLInputElement,
      new File(['pdf contents'], 'Club-Guide.PDF', { type: 'application/pdf' }),
    );
    await user.clear(screen.getByLabelText('Description (optional)'));
    await user.type(screen.getByLabelText('Description (optional)'), '  Member information  ');
    fireEvent.submit(document.getElementById('document-pdf')?.closest('form') as HTMLFormElement);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not upload PDF. Please try again.',
    );
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].path).toMatch(/^admin-1\/.+\.pdf$/);
    expect(mocks.uploaded[0].options).toEqual({ contentType: 'application/pdf', upsert: false });
    expect(mocks.inserted[0]).toMatchObject({
      title: 'Club-Guide',
      description: 'Member information',
      category: 'general',
      uploaded_by: 'admin-1',
      mime_type: 'application/pdf',
    });
    expect(mocks.deleted).toContain(mocks.uploaded[0].path);
  });

  it('requires delete confirmation and preserves metadata when storage deletion fails', async () => {
    mocks.storageError = { message: 'storage unavailable' };
    const user = userEvent.setup();
    render(<AdminDocumentsContent embedded />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete “Club handbook”?');
    expect(mocks.deleted).toHaveLength(0);
    await user.click(
      screen.getByRole('alertdialog').querySelector('button:last-child') as HTMLButtonElement,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not delete document. Please try again.',
    );
    expect(mocks.deleted).toEqual(['admin-1/handbook.pdf']);
    expect(screen.getByText('Club handbook')).toBeInTheDocument();
  });
});
