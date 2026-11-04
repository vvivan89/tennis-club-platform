import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  documents: {} as Record<string, unknown>,
  club: null as null | Record<string, unknown>,
  browserClub: null as null | Record<string, unknown>,
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      let documentType = '';
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          if (column === 'document_type') documentType = value;
          return query;
        },
        maybeSingle: async () => ({
          data:
            table === 'legal_document_versions'
              ? (mocks.documents[documentType] ?? null)
              : mocks.club,
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mocks.browserClub, error: null }) }),
      }),
    }),
  }),
}));
vi.mock('@/components/site-header', () => ({
  SiteHeader: ({ clubName }: { clubName: string }) => <header>{clubName}</header>,
}));

import TermsPage from '@/app/legal/terms/page';
import DisclaimerPage from '@/app/legal/disclaimer/page';
import ApplicationError from '@/app/error';
import { SiteFooter } from '@/components/site-footer';

beforeEach(() => {
  mocks.documents = {};
  mocks.club = null;
  mocks.browserClub = null;
  mocks.rpc.mockReset();
});
afterEach(() => cleanup());

describe('legal pages', () => {
  it('renders default terms and disclaimer when no current documents or club settings exist', async () => {
    render(await TermsPage());
    expect(screen.getByRole('heading', { name: 'Terms of Use' })).toBeInTheDocument();
    expect(screen.getByText('Terms of use have not been published yet.')).toBeInTheDocument();
    expect(screen.getAllByText('Port Coquitlam Tennis Club').length).toBeGreaterThan(1);

    cleanup();
    render(await DisclaimerPage());
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(screen.getByText('Disclaimer has not been published yet.')).toBeInTheDocument();
  });

  it('renders published legal copy, version dates, and configured club names', async () => {
    mocks.documents.terms_of_use = {
      title: 'Club Terms',
      body_html: '<p>Published terms.</p>',
      version: 5,
      created_at: '2026-03-15T12:00:00Z',
    };
    mocks.documents.disclaimer = {
      title: 'Court Disclaimer',
      body_html: '<p>Published disclaimer.</p>',
      version: 2,
      created_at: '2026-04-20T12:00:00Z',
    };
    mocks.club = { club_name: 'Custom Tennis Club', short_name: 'CTC', social_links: [] };

    render(await TermsPage());
    expect(screen.getByRole('heading', { name: 'Club Terms' })).toBeInTheDocument();
    expect(screen.getByText('Published terms.')).toBeInTheDocument();
    expect(screen.getByText(/Version 5/)).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Custom Tennis Club');

    cleanup();
    render(await DisclaimerPage());
    expect(screen.getByRole('heading', { name: 'Court Disclaimer' })).toBeInTheDocument();
    expect(screen.getByText('Published disclaimer.')).toBeInTheDocument();
    expect(screen.getByText(/Version 2/)).toBeInTheDocument();
  });
});

describe('SiteFooter', () => {
  it('uses supplied settings and chooses an icon for each supported social host', () => {
    render(
      <SiteFooter
        clubName="Supplied Club"
        shortName="SC"
        socialLinks={[
          { url: 'https://facebook.com/club' },
          { url: 'https://instagram.com/club' },
          { url: 'https://x.com/club' },
          { url: 'https://youtu.be/video' },
          { url: 'https://linkedin.com/company/club' },
          { url: 'https://tiktok.com/@club' },
          { url: 'https://club.example/social' },
        ]}
      />,
    );
    expect(screen.getByText('Supplied Club')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Supplied Club (SC)');
    expect(screen.getAllByRole('link', { name: /Social media link/ })).toHaveLength(7);
  });

  it('loads settings asynchronously, uses defaults for missing fields, and tolerates non-array socials', async () => {
    mocks.browserClub = {
      club_name: '',
      short_name: null,
      social_links: { malformed: true },
    };
    render(<SiteFooter clubName="Partial Club" />);
    await waitFor(() => expect(screen.getByText('Port Coquitlam Tennis Club')).toBeInTheDocument());
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Port Coquitlam Tennis Club (PCTC)');
    expect(screen.queryByRole('link', { name: /Social media link/ })).not.toBeInTheDocument();
  });
});

describe('ApplicationError', () => {
  it('logs a bounded error payload and invokes the reset action', async () => {
    const reset = vi.fn();
    mocks.rpc.mockReturnValue(Promise.resolve({ error: null }));
    const error = Object.assign(new Error('x'.repeat(2200)), { digest: 'digest-1' });
    const user = userEvent.setup();
    render(<ApplicationError error={error} reset={reset} />);

    expect(mocks.rpc).toHaveBeenCalledWith(
      'record_application_error',
      expect.objectContaining({
        p_error_type: 'Error',
        p_message: 'x'.repeat(2000),
        p_correlation_id: 'digest-1',
        p_details: { digest: 'digest-1' },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('falls back for unnamed errors and swallows synchronous logging failures', () => {
    mocks.rpc.mockImplementation(() => {
      throw new Error('logging unavailable');
    });
    const error = Object.assign(new Error(''), { name: '', digest: undefined });
    expect(() => render(<ApplicationError error={error} reset={vi.fn()} />)).not.toThrow();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'record_application_error',
      expect.objectContaining({
        p_error_type: 'UnhandledApplicationError',
        p_message: 'Unexpected application error',
        p_correlation_id: null,
        p_details: { digest: null },
      }),
    );
  });
});
