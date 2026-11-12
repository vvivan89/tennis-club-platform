import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/components/site-header-state', () => ({
  SiteHeaderStateProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSiteHeaderState: () => ({ shortName: 'Configured Club' }),
}));
vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { short_name: 'Configured Club' } }) }),
      }),
    }),
  }),
}));

import ApplicationError from '@/app/error';
import RootLayout, { generateMetadata } from '@/app/layout';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('application shell', () => {
  it('reports error metadata and invokes the recovery callback', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const reset = vi.fn();
    render(
      <ApplicationError
        error={Object.assign(new Error('Page failed'), { digest: 'digest-1' })}
        reset={reset}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'record_application_error',
        expect.objectContaining({
          p_error_type: 'Error',
          p_message: 'Page failed',
          p_operation: 'react.error_boundary',
          p_correlation_id: 'digest-1',
          p_details: { digest: 'digest-1' },
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('wraps children in the locale root and loads configured club metadata', async () => {
    const layout = RootLayout({ children: <p>Page content</p> });
    const markup = renderToStaticMarkup(layout);
    expect(markup).toContain('<html lang="en-CA" data-accent="green">');
    expect(markup).toContain('Page content');
    await expect(generateMetadata()).resolves.toMatchObject({
      title: 'Configured Club',
      description: expect.stringContaining('Membership'),
    });
  });
});
