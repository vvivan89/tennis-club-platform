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
  mocks.routerReplace.mockReset();
  window.history.replaceState({}, '', '/');
  mocks.fetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/email-history')
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
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

    expect(await screen.findAllByText('Club information saved.')).toHaveLength(2);
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

    expect(await screen.findAllByText('Contact details saved.')).toHaveLength(2);
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

    expect(await screen.findAllByText('Contact details saved.')).toHaveLength(2);
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

    expect(
      await screen.findByText('Email announcement sent: 2 successful, 1 failed.'),
    ).toBeInTheDocument();
    const request = mocks.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(request?.[0]).toBe('/api/admin/send-email');
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      subject: 'Court closure',
      html: '<p>Courts closed Friday</p>',
      group: 'active_members',
    });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/email-history'));
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
});
