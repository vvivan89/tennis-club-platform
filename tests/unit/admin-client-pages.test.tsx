import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'admin-1' } as null | { id: string },
  profile: { role: 'admin', application_status: 'approved' } as null | Record<string, unknown>,
  rows: {} as Record<string, unknown[]>,
  singles: {} as Record<string, unknown>,
  errors: {} as Record<string, { message: string }>,
  writes: [] as Array<{ table: string; operation: string; values: Record<string, unknown> }>,
  storageUploads: [] as Array<{ bucket: string; path: string; file: File; options: unknown }>,
  storageUploadError: null as null | { message: string },
  routerReplace: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('next/navigation', () => {
  const router = { replace: mocks.routerReplace };
  return { useRouter: () => router };
});
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: File, options: unknown) => {
          mocks.storageUploads.push({ bucket, path, file, options });
          return { error: mocks.storageUploadError };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
      }),
    },
    from: (table: string) => {
      let operation = 'select';
      let values: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        upsert: (payload: Record<string, unknown>) => {
          operation = 'upsert';
          values = payload;
          mocks.writes.push({ table, operation, values });
          return query;
        },
        insert: (payload: Record<string, unknown>) => {
          operation = 'insert';
          values = payload;
          mocks.writes.push({ table, operation, values });
          return query;
        },
        update: (payload: Record<string, unknown>) => {
          operation = 'update';
          values = payload;
          mocks.writes.push({ table, operation, values });
          return query;
        },
        delete: () => {
          operation = 'delete';
          mocks.writes.push({ table, operation, values: {} });
          return query;
        },
        maybeSingle: async () => ({
          data: table === 'profiles' ? mocks.profile : (mocks.singles[table] ?? null),
          error: mocks.errors[`${table}.maybeSingle`] ?? null,
        }),
        single: async () => ({ data: { id: 'news-new', title: 'Draft' }, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.rows[table] ?? [],
            error: mocks.errors[`${table}.${operation}`] ?? null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/admin-section-tabs', () => ({ AdminSectionTabs: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/rich-text-editor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Rich text content"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock('@/components/admin-gallery-content', () => ({
  AdminGalleryContent: () => <div>Gallery editor</div>,
}));
vi.mock('@/components/admin-documents-content', () => ({
  AdminDocumentsContent: () => <div>Uploaded documents editor</div>,
}));

import ClubProfileAdminPage from '@/app/admin/club-profile/page';
import AdminLegalPage from '@/app/admin/documents/page';
import WebsiteAdminPage from '@/app/admin/website/page';

beforeEach(() => {
  mocks.user = { id: 'admin-1' };
  mocks.profile = { role: 'admin', application_status: 'approved' };
  mocks.rows = {};
  mocks.singles = {
    club_settings: {
      club_name: 'Port Coquitlam Tennis Club',
      short_name: 'PCTC',
      description: '',
      contact_email: 'info@example.com',
      contact_phone: '6045550100',
      location_url: '',
      location_query: 'Port Coquitlam',
      social_links: [{ url: 'https://instagram.com/pctc' }],
      logo_url: '',
    },
  };
  mocks.errors = {};
  mocks.writes = [];
  mocks.storageUploads = [];
  mocks.storageUploadError = null;
  mocks.routerReplace.mockReset();
  window.history.replaceState({}, '', '/');
  mocks.fetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/email-history')
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    if (init?.method === 'POST' && JSON.parse(String(init.body)).preview)
      return new Response(JSON.stringify({ recipientCount: 3 }), { status: 200 });
    if (init?.method === 'POST')
      return new Response(JSON.stringify({ sent: 2, failed: 1 }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin client pages', () => {
  it('validates map/social URLs and saves normalized club profile settings', async () => {
    const user = userEvent.setup();
    render(<ClubProfileAdminPage />);
    await screen.findByRole('tab', { name: 'Club info' });
    fireEvent.change(screen.getByLabelText('Social media URL 1'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Save club information' })
        .closest('form') as HTMLFormElement,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid social media URL');

    fireEvent.change(screen.getByLabelText('Social media URL 1'), {
      target: { value: 'https://instagram.com/pctc' },
    });
    await user.clear(screen.getByLabelText('General contact phone'));
    await user.type(screen.getByLabelText('General contact phone'), '6045550123');
    fireEvent.blur(screen.getByLabelText('General contact phone'));
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Save club information' })
        .closest('form') as HTMLFormElement,
    );

    expect(await screen.findAllByText('Club information saved.')).toHaveLength(1);
    expect(mocks.writes).toContainEqual({
      table: 'club_settings',
      operation: 'upsert',
      values: expect.objectContaining({
        id: 1,
        club_name: 'Port Coquitlam Tennis Club',
        contact_phone: '604.555.0123',
        social_links: [{ url: 'https://instagram.com/pctc' }],
      }),
    });
  });

  it('requires a map search location for valid map links and reports failed profile saves', async () => {
    const user = userEvent.setup();
    render(<ClubProfileAdminPage />);
    await screen.findByRole('tab', { name: 'Club info' });
    await user.clear(
      screen.getByPlaceholderText('e.g. Port Coquitlam Tennis Club, Port Coquitlam, BC'),
    );
    await user.type(
      screen.getByPlaceholderText('https://maps.app.goo.gl/...'),
      'javascript:alert(1)',
    );
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save club information' }).closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid Google Maps link.');

    await user.clear(screen.getByPlaceholderText('https://maps.app.goo.gl/...'));
    await user.type(
      screen.getByPlaceholderText('https://maps.app.goo.gl/...'),
      'https://maps.google.com/?q=courts',
    );
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save club information' }).closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter the club address or place name so the map can be embedded reliably.',
    );

    await user.type(
      screen.getByPlaceholderText('e.g. Port Coquitlam Tennis Club, Port Coquitlam, BC'),
      'Tennis courts',
    );
    mocks.errors['club_settings.upsert'] = { message: 'database unavailable' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save club information' }).closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save club information. Please try again.',
    );
    expect(consoleError).toHaveBeenCalled();
  });

  it('renders the matching icon for each supported social network and a fallback icon', async () => {
    mocks.singles.club_settings = {
      ...(mocks.singles.club_settings as Record<string, unknown>),
      social_links: [
        { url: 'https://facebook.com/pctc' },
        { url: 'https://instagram.com/pctc' },
        { url: 'https://x.com/pctc' },
        { url: 'https://youtu.be/pctc' },
        { url: 'https://linkedin.com/company/pctc' },
        { url: 'https://tiktok.com/@pctc' },
        { url: 'https://example.test/pctc' },
      ],
    };
    const { container } = render(<ClubProfileAdminPage />);
    await screen.findByDisplayValue('Port Coquitlam Tennis Club');
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(7);
  });

  it('validates logo files, uploads accepted images, and can remove the uploaded logo', async () => {
    const user = userEvent.setup();
    render(<ClubProfileAdminPage />);
    await screen.findByRole('tab', { name: 'Club info' });
    const input = screen.getByLabelText('Club logo') as HTMLInputElement;
    const wrongType = new File(['not image'], 'logo.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [wrongType] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Upload a PNG, JPEG, WebP, or SVG logo.',
    );
    expect(mocks.storageUploads).toHaveLength(0);

    const tooLarge = new File(['image'], 'large.png', { type: 'image/png' });
    Object.defineProperty(tooLarge, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [tooLarge] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The logo must be 5 MB or smaller.');
    expect(mocks.storageUploads).toHaveLength(0);

    const valid = new File(['image data'], 'club logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [valid] } });
    expect(
      await screen.findAllByText('Logo uploaded. Save the club profile to publish it.'),
    ).toHaveLength(1);
    expect(mocks.storageUploads).toHaveLength(1);
    expect(mocks.storageUploads[0]).toMatchObject({
      bucket: 'club-assets',
      file: valid,
      options: { upsert: true, contentType: 'image/png' },
    });
    expect(screen.getByRole('img', { name: 'Club logo preview' })).toHaveAttribute(
      'src',
      expect.stringContaining('https://cdn.example/logo/'),
    );
    await user.click(screen.getByRole('button', { name: 'Remove logo' }));
    expect(screen.queryByRole('img', { name: 'Club logo preview' })).not.toBeInTheDocument();
  });

  it('reports storage upload failures without changing the configured logo', async () => {
    mocks.singles.club_settings = {
      ...(mocks.singles.club_settings as Record<string, unknown>),
      logo_url: 'https://cdn.example/old.png',
    };
    mocks.storageUploadError = { message: 'storage unavailable' };
    render(<ClubProfileAdminPage />);
    await screen.findByRole('tab', { name: 'Club info' });
    fireEvent.change(screen.getByLabelText('Club logo'), {
      target: { files: [new File(['image'], 'new.png', { type: 'image/png' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not upload the logo. Please try again.',
    );
    expect(screen.getByRole('img', { name: 'Club logo preview' })).toHaveAttribute(
      'src',
      'https://cdn.example/old.png',
    );
  });

  it('validates contact rows and saves normalized private club-contact details', async () => {
    mocks.rows.profiles = [
      { id: 'member-2', full_name: 'Jordan Member', email: 'jordan@example.com' },
    ];
    mocks.rows.club_contacts = [];
    const user = userEvent.setup();
    render(<ClubProfileAdminPage />);
    await user.click(await screen.findByRole('tab', { name: 'Club contacts' }));
    await user.click(screen.getByRole('button', { name: 'Add contact' }));
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Save contact details' })
        .closest('form') as HTMLFormElement,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a member and enter a position for each contact row',
    );
    expect(mocks.writes.some((write) => write.table === 'club_contacts')).toBe(false);

    await user.selectOptions(screen.getByLabelText('Member'), 'member-2');
    await user.type(screen.getByPlaceholderText('e.g. President'), '  Treasurer  ');
    await user.type(
      screen.getByPlaceholderText('person@example.com, office@example.com'),
      ' jordan@example.com , office@example.com ',
    );
    await user.type(screen.getByPlaceholderText('604.555.0100, 604.555.0101'), ' 6045550123 ');
    await user.click(screen.getByLabelText(/Reveal contact information on public Contacts page/));
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Save contact details' })
        .closest('form') as HTMLFormElement,
    );

    expect(await screen.findAllByText('Contact details saved.')).toHaveLength(1);
    expect(mocks.writes).toContainEqual({
      table: 'club_contacts',
      operation: 'insert',
      values: expect.objectContaining({
        profile_id: 'member-2',
        position: 'Treasurer',
        emails: ['jordan@example.com', 'office@example.com'],
        phones: ['6045550123'],
        is_public: true,
        sort_order: 0,
      }),
    });
  });

  it('updates retained club contacts and deletes contact rows removed from the list', async () => {
    mocks.rows.profiles = [
      { id: 'member-2', full_name: 'Jordan Member', email: 'jordan@example.com' },
      { id: 'member-3', full_name: 'Casey Member', email: 'casey@example.com' },
    ];
    mocks.rows.club_contacts = [
      {
        id: 'contact-keep',
        profile_id: 'member-2',
        position: 'Secretary',
        emails: ['jordan@example.com'],
        phones: ['604.555.0100'],
        is_public: false,
        sort_order: 0,
      },
      {
        id: 'contact-remove',
        profile_id: 'member-3',
        position: 'Director',
        emails: [],
        phones: [],
        is_public: true,
        sort_order: 1,
      },
    ];
    const user = userEvent.setup();
    render(<ClubProfileAdminPage />);
    await user.click(await screen.findByRole('tab', { name: 'Club contacts' }));
    await user.clear(screen.getAllByLabelText('Position')[0]);
    await user.type(screen.getAllByLabelText('Position')[0], '  Treasurer  ');
    const removedContact = screen
      .getAllByLabelText('Position')[1]
      .closest('.rounded-lg.border') as HTMLElement;
    await user.click(within(removedContact).getByRole('button', { name: 'Remove' }));
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Save contact details' })
        .closest('form') as HTMLFormElement,
    );

    expect(await screen.findAllByText('Contact details saved.')).toHaveLength(1);
    expect(mocks.writes).toContainEqual({
      table: 'club_contacts',
      operation: 'update',
      values: expect.objectContaining({
        profile_id: 'member-2',
        position: 'Treasurer',
        emails: ['jordan@example.com'],
        phones: ['604.555.0100'],
        is_public: false,
        sort_order: 0,
      }),
    });
    expect(mocks.writes).toContainEqual({
      table: 'club_contacts',
      operation: 'delete',
      values: {},
    });
  });

  it.each([
    ['delete', 'Could not save contact details. Please try again.'],
    ['insert', 'Could not save contact details. Please try again.'],
  ])('shows an error when saving club contacts fails during %s', async (operation, message) => {
    mocks.rows.profiles = [
      { id: 'member-2', full_name: 'Jordan Member', email: 'jordan@example.com' },
    ];
    mocks.rows.club_contacts =
      operation === 'delete'
        ? [
            {
              id: 'old-contact',
              profile_id: 'member-2',
              position: 'Director',
              emails: [],
              phones: [],
            },
          ]
        : [];
    mocks.errors[`club_contacts.${operation}`] = { message: 'database unavailable' };
    const user = userEvent.setup();
    render(<ClubProfileAdminPage />);
    await user.click(await screen.findByRole('tab', { name: 'Club contacts' }));

    if (operation === 'delete') {
      const existing = screen
        .getByLabelText('Position')
        .closest('.rounded-lg.border') as HTMLElement;
      if (existing) await user.click(within(existing).getByRole('button', { name: 'Remove' }));
    } else {
      await user.click(screen.getByRole('button', { name: 'Add contact' }));
      await user.selectOptions(screen.getByLabelText('Member'), 'member-2');
      await user.type(screen.getByPlaceholderText('e.g. President'), 'President');
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Save contact details' })
        .closest('form') as HTMLFormElement,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(consoleError).toHaveBeenCalled();
  });

  it('archives the current legal version and saves a new incremented version', async () => {
    window.history.replaceState({}, '', '/admin/documents?tab=terms_of_use');
    mocks.rows.legal_document_versions = [
      {
        id: 'terms-v3',
        document_type: 'terms_of_use',
        version: 3,
        title: 'Current terms',
        body_html: '<p>Current content</p>',
        is_current: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'terms-v2',
        document_type: 'terms_of_use',
        version: 2,
        title: 'Prior terms',
        body_html: '<p>Prior content</p>',
        is_current: false,
        created_at: '2025-01-01T00:00:00Z',
      },
    ];
    const user = userEvent.setup();
    render(<AdminLegalPage />);
    await screen.findByDisplayValue('Current terms');
    await user.clear(screen.getByLabelText('Document title'));
    await user.type(screen.getByLabelText('Document title'), 'Updated terms');
    await user.clear(screen.getByLabelText('Rich text content'));
    await user.type(screen.getByLabelText('Rich text content'), '<p>Updated content</p>');
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save new version' }).closest('form') as HTMLFormElement,
    );

    expect(
      await screen.findByText('Saved as version 4. Previous versions have been preserved.'),
    ).toBeInTheDocument();
    expect(mocks.writes).toContainEqual({
      table: 'legal_document_versions',
      operation: 'update',
      values: { is_current: false },
    });
    expect(mocks.writes).toContainEqual({
      table: 'legal_document_versions',
      operation: 'insert',
      values: expect.objectContaining({
        document_type: 'terms_of_use',
        version: 4,
        title: 'Updated terms',
        body_html: '<p>Updated content</p>',
        created_by: 'admin-1',
        is_current: true,
      }),
    });
  });

  it('validates legal document content and reports archive or insert failures', async () => {
    const user = userEvent.setup();
    render(<AdminLegalPage />);
    const title = await screen.findByLabelText('Document title');
    await user.clear(title);
    fireEvent.submit(screen.getByRole('button', { name: 'Save new version' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a document title and text.');

    await user.type(title, 'New waiver');
    mocks.errors['legal_document_versions.update'] = { message: 'archive failed' };
    fireEvent.submit(screen.getByRole('button', { name: 'Save new version' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save legal document. Please try again.',
    );

    delete mocks.errors['legal_document_versions.update'];
    mocks.errors['legal_document_versions.insert'] = { message: 'insert failed' };
    fireEvent.submit(screen.getByRole('button', { name: 'Save new version' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save legal document. Please try again.',
    );
  });

  it('shows legal document load errors and supports the uploaded documents tab', async () => {
    mocks.errors['legal_document_versions.select'] = { message: 'database unavailable' };
    window.history.replaceState({}, '', '/admin/documents?tab=disclaimer');
    const { unmount } = render(<AdminLegalPage />);
    expect(
      await screen.findByText('Could not load legal documents. Please try again.'),
    ).toBeInTheDocument();
    unmount();

    window.history.replaceState({}, '', '/admin/documents?tab=uploaded_documents');
    render(<AdminLegalPage />);
    expect(await screen.findByText('Uploaded documents editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save new version' })).not.toBeInTheDocument();
  });

  it('sends email announcements to the selected group and reports delivery counts', async () => {
    window.history.replaceState({}, '', '/admin/website?tab=announcements');
    const user = userEvent.setup();
    render(<WebsiteAdminPage />);
    await user.type(await screen.findByLabelText('Email subject'), 'Court closure');
    await user.type(screen.getByLabelText('Rich text content'), '<p>Courts closed Friday</p>');
    await user.selectOptions(screen.getByLabelText('Recipient group'), 'active_members');
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Send email announcement' })
        .closest('form') as HTMLFormElement,
    );

    expect(await screen.findByText('This will email 3 recipients.')).toBeInTheDocument();
    expect(
      mocks.fetch.mock.calls.filter(
        ([, init]) => init?.method === 'POST' && !JSON.parse(String(init.body)).preview,
      ),
    ).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText('Email announcement sent: 2 successful, 1 failed.'),
    ).toBeInTheDocument();
    const request = mocks.fetch.mock.calls.find(
      ([, init]) => init?.method === 'POST' && !JSON.parse(String(init.body)).preview,
    );
    expect(request?.[0]).toBe('/api/admin/send-email');
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      subject: 'Court closure',
      html: '<p>Courts closed Friday</p>',
      group: 'active_members',
    });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/email-history'));
  });

  it('asks for confirmation naming the audience before emailing all approved members', async () => {
    window.history.replaceState({}, '', '/admin/website?tab=announcements');
    const user = userEvent.setup();
    render(<WebsiteAdminPage />);
    await user.type(await screen.findByLabelText('Email subject'), 'Season update');
    await user.type(screen.getByLabelText('Rich text content'), '<p>News</p>');
    expect(screen.getByLabelText('Recipient group')).toHaveValue('all');
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Send email announcement' })
        .closest('form') as HTMLFormElement,
    );
    expect(
      await screen.findByText(
        'This will email all 3 approved members, including those who have opted out of newsletters.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      mocks.fetch.mock.calls.filter(
        ([, init]) => init?.method === 'POST' && !JSON.parse(String(init.body)).preview,
      ),
    ).toHaveLength(0);
  });

  it('reports empty recipient groups and API validation errors during announcement preview', async () => {
    window.history.replaceState({}, '', '/admin/website?tab=announcements');
    const user = userEvent.setup();
    render(<WebsiteAdminPage />);
    await user.type(await screen.findByLabelText('Email subject'), 'Update');
    await user.type(screen.getByLabelText('Rich text content'), 'Details');

    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/email-history') return new Response('{}', { status: 503 });
      if (init?.method === 'POST')
        return new Response(JSON.stringify({ recipientCount: 0 }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send email announcement' }).closest('form')!,
    );
    expect(
      await screen.findByText('This group has no recipients with an email address.'),
    ).toBeInTheDocument();

    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return new Response(JSON.stringify({ error: 'Audience is unavailable.' }), { status: 422 });
      return new Response('{}', { status: 200 });
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send email announcement' }).closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Audience is unavailable.');
  });

  it('uses a generic preview error for server failures and handles malformed responses', async () => {
    window.history.replaceState({}, '', '/admin/website?tab=announcements');
    const user = userEvent.setup();
    render(<WebsiteAdminPage />);
    await user.type(await screen.findByLabelText('Email subject'), 'Update');
    await user.type(screen.getByLabelText('Rich text content'), 'Details');

    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ error: 'Internal detail' }), { status: 500 })
        : new Response('{}', { status: 200 }),
    );
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send email announcement' }).closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not send email. Please try again.',
    );

    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response('not json', { status: 400 })
        : new Response('{}', { status: 200 }),
    );
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send email announcement' }).closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not send email. Please try again.',
    );
  });

  it('reports delivery failures and refreshes history after sending an announcement', async () => {
    window.history.replaceState({}, '', '/admin/website?tab=announcements');
    const user = userEvent.setup();
    render(<WebsiteAdminPage />);
    await user.type(await screen.findByLabelText('Email subject'), 'Update');
    await user.type(screen.getByLabelText('Rich text content'), 'Details');
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/email-history')
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (init?.method === 'POST' && JSON.parse(String(init.body)).preview)
        return new Response(JSON.stringify({ recipientCount: 1 }), { status: 200 });
      if (init?.method === 'POST')
        return new Response(JSON.stringify({ sent: 0, failed: 1 }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send email announcement' }).closest('form')!,
    );
    await user.click(await screen.findByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('Email announcement sent: 0 successful, 1 failed.'),
    ).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/email-history');
  });

  it('creates a news draft, publishes and unpublishes it, then confirms deletion', async () => {
    mocks.rows.news = [
      {
        id: 'news-draft',
        title: 'Draft announcement',
        body: '<p>Draft body</p>',
        published: false,
        published_at: null,
        created_at: '2026-10-20T12:00:00Z',
      },
      {
        id: 'news-live',
        title: 'Published announcement',
        body: '<p>Live body</p>',
        published: true,
        published_at: '2026-10-20T12:00:00Z',
        created_at: '2026-10-20T12:00:00Z',
      },
    ];
    const user = userEvent.setup();
    render(<WebsiteAdminPage />);
    await screen.findByText('Draft announcement');
    await user.type(screen.getByLabelText('Headline'), 'New club news');
    await user.type(screen.getByLabelText('Rich text content'), '<p>New details</p>');
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Save website news draft' })
        .closest('form') as HTMLFormElement,
    );
    expect(await screen.findByText('Website news draft created.')).toBeInTheDocument();
    expect(mocks.writes).toContainEqual({
      table: 'news',
      operation: 'insert',
      values: expect.objectContaining({
        title: 'New club news',
        body: '<p>New details</p>',
        published: false,
        created_by: 'admin-1',
      }),
    });

    const draftCard = screen.getByText('Draft announcement').closest('.rounded-xl') as HTMLElement;
    await user.click(within(draftCard).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('News published on the main website.')).toBeInTheDocument();
    expect(mocks.writes).toContainEqual({
      table: 'news',
      operation: 'update',
      values: expect.objectContaining({ published: true, published_at: expect.any(String) }),
    });

    await user.click(within(draftCard).getByRole('button', { name: 'Unpublish' }));
    expect(
      await screen.findByText(
        'Website news unpublished. Email announcements are managed separately.',
      ),
    ).toBeInTheDocument();
    expect(mocks.writes).toContainEqual({
      table: 'news',
      operation: 'update',
      values: expect.objectContaining({ published: false, published_at: null }),
    });

    await user.click(within(draftCard).getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete website news item?');
    await user.click(
      screen.getByRole('alertdialog').querySelector('button:last-child') as HTMLButtonElement,
    );
    await waitFor(() => expect(screen.queryByText('Draft announcement')).not.toBeInTheDocument());
    expect(mocks.writes).toContainEqual({ table: 'news', operation: 'delete', values: {} });
  });

  it('reports website news load and mutation failures and renders historical email audiences', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/admin/website?tab=gallery');
    const gallery = render(<WebsiteAdminPage />);
    expect(await screen.findByText('Gallery editor')).toBeInTheDocument();
    gallery.unmount();

    window.history.replaceState({}, '', '/admin/website');
    mocks.errors['news.select'] = { message: 'temporarily unavailable' };
    const { unmount } = render(<WebsiteAdminPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load website news');
    unmount();
    delete mocks.errors['news.select'];

    mocks.rows.news = [
      {
        id: 'news-item',
        title: 'Current draft',
        body: '<p>Body</p>',
        published: false,
        published_at: null,
        created_at: '2026-10-01T12:00:00Z',
      },
    ];
    mocks.fetch.mockImplementation(async (url: string) =>
      url === '/api/admin/email-history'
        ? new Response(
            JSON.stringify({
              items: [
                {
                  id: 'email-1',
                  subject: 'Older notice',
                  body_html: '<p>Sent</p>',
                  recipient_group: 'legacy_group',
                  sent_count: 3,
                  failed_count: 1,
                  sent_at: '2026-10-01T12:00:00Z',
                },
              ],
            }),
            { status: 200 },
          )
        : new Response('{}', { status: 200 }),
    );
    window.history.replaceState({}, '', '/admin/website?tab=announcements');
    const announcements = render(<WebsiteAdminPage />);
    expect(await screen.findByText('Older notice')).toBeInTheDocument();
    expect(screen.getByText('Older notice').closest('.rounded-xl')).toHaveTextContent(
      'legacy_group',
    );
    announcements.unmount();

    window.history.replaceState({}, '', '/admin/website?tab=news');
    render(<WebsiteAdminPage />);
    const draft = (await screen.findByText('Current draft')).closest('.rounded-xl') as HTMLElement;
    mocks.errors['news.update'] = { message: 'write denied' };
    const user = userEvent.setup();
    await user.click(within(draft).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update website news');
    delete mocks.errors['news.update'];

    mocks.errors['news.delete'] = { message: 'delete denied' };
    await user.click(within(draft).getByRole('button', { name: 'Delete' }));
    await user.click(
      screen.getByRole('alertdialog').querySelector('button:last-child') as HTMLButtonElement,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete website news');
    delete mocks.errors['news.delete'];
    expect(consoleError).toHaveBeenCalled();
  });
});
