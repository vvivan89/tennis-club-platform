import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ pathname: '/admin/members' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
import { AdminSectionTabs } from '@/components/admin-section-tabs';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  mocks.pathname = '/admin/members';
});

describe('AdminSectionTabs', () => {
  it('marks the default membership tab and current membership type tab', async () => {
    window.history.replaceState({}, '', '/admin/members');
    render(<AdminSectionTabs section="membership" />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByRole('tab', { name: 'Membership types' })).toHaveAttribute(
      'href',
      '/admin/members?tab=membership-types',
    );

    cleanup();
    window.history.replaceState({}, '', '/admin/members?tab=applications');
    render(<AdminSectionTabs section="membership" />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Applications' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });

  it('handles publication and legal tab query parameters', async () => {
    mocks.pathname = '/admin/website';
    window.history.replaceState({}, '', '/admin/website?tab=gallery');
    render(<AdminSectionTabs section="publications" />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Gallery' })).toHaveAttribute('aria-selected', 'true'),
    );

    cleanup();
    mocks.pathname = '/admin/documents';
    window.history.replaceState({}, '', '/admin/documents?tab=terms_of_use');
    render(<AdminSectionTabs section="legal" />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Terms of use' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });
});
