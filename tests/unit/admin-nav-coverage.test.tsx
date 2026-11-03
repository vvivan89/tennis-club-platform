import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  pathname: '/admin/payments',
  role: 'admin',
  applications: 124,
  interac: 4,
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'club_settings' ? null : { role: mocks.role },
        }),
      };
      return query;
    },
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
  }),
}));
vi.mock('@/lib/use-pending-member-applications-count', () => ({
  usePendingMemberApplicationsCount: (enabled: boolean) => (enabled ? mocks.applications : 0),
}));
vi.mock('@/lib/use-pending-interac-payments-count', () => ({
  usePendingInteracPaymentsCount: (enabled: boolean) => (enabled ? mocks.interac : 0),
}));

import { AdminNav } from '@/components/admin-nav';

afterEach(() => {
  cleanup();
  mocks.pathname = '/admin/payments';
  mocks.role = 'admin';
  mocks.applications = 124;
  mocks.interac = 4;
  vi.clearAllMocks();
});

describe('AdminNav role, active link and review badges', () => {
  it('caps the application badge, displays the Interac count and marks the matching route', async () => {
    render(<AdminNav />);
    const membership = await screen.findByRole('link', { name: /Membership/ });
    const payments = screen.getByRole('link', { name: /Payments/ });
    expect(membership).toHaveTextContent('99+');
    expect(membership).toHaveAccessibleName('Membership 124 pending applications');
    expect(payments).toHaveTextContent('4');
    expect(payments).toHaveAccessibleName('Payments 4 unreviewed Interac payments');
    expect(payments).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Admin Portal')).toBeInTheDocument();
  });

  it('uses organizer links without admin review badges and treats the portal root as dashboard', async () => {
    mocks.pathname = '/admin';
    mocks.role = 'organizer';
    render(<AdminNav />);
    expect(await screen.findByText('Organizer Portal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: /Membership/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Payments/ })).not.toBeInTheDocument();
  });
});
