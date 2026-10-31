import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { application_status?: string; role?: string },
  rows: {} as Record<string, unknown[]>,
  singles: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  routerReplace: vi.fn(),
  syncPaymentProceeds: vi.fn(),
}));

function queryFor(table: string, source: 'auth' | 'payments') {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    range: () => query,
    maybeSingle: async () => ({
      data: table === 'profiles' ? mocks.profile : (mocks.singles[table] ?? null),
      error: mocks.errors[`${table}.single`] ?? null,
    }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({
        data: mocks.rows[table] ?? [],
        error: mocks.errors[`${table}.rows`] ?? null,
      }).then(resolve, reject),
  };
  return query;
}
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), replace: mocks.routerReplace }),
  usePathname: () => '/admin/payments',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    channel: () => ({ on: () => ({ subscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  }),
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => queryFor(table, 'auth'),
  }),
}));
vi.mock('@/lib/payments/server', () => ({
  createPaymentServiceClient: () => ({ from: (table: string) => queryFor(table, 'payments') }),
}));
vi.mock('@/lib/payments/proceeds', () => ({ syncPaymentProceeds: mocks.syncPaymentProceeds }));
vi.mock('@/components/admin-nav', () => ({ AdminNav: () => null }));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/member-nav', () => ({ MemberNav: () => null }));
vi.mock('@/components/member-chat', () => ({
  MemberChat: ({ userId }: { userId: string }) => <div>Chat for {userId}</div>,
}));

import AdminPaymentsPage from '@/app/admin/payments/page';
import MemberPaymentsPage from '@/app/member/payments/page';
import MemberChatPage from '@/app/member/chat/page';

beforeEach(() => {
  mocks.user = { id: 'member-1' };
  mocks.profile = { application_status: 'approved', role: 'admin' };
  mocks.rows = {};
  mocks.singles = {};
  mocks.errors = {};
  mocks.redirect.mockClear();
  mocks.syncPaymentProceeds.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('member payment history page', () => {
  it('redirects anonymous and unapproved members', async () => {
    mocks.user = null;
    await expect(MemberPaymentsPage()).rejects.toThrow('redirect:/login?next=/member/payments');
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'pending' };
    await expect(MemberPaymentsPage()).rejects.toThrow('redirect:/member/dashboard');
  });

  it('renders an event-linked payment and shows a safe error when history is unavailable', async () => {
    mocks.rows.payments = [
      {
        id: 'payment-1',
        purpose: 'event_registration',
        business_record_id: 'registration-1',
        amount_minor: 2500,
        currency: 'cad',
        status: 'succeeded',
        refunded_amount_minor: 0,
        created_at: '2026-06-01T12:00:00Z',
        succeeded_at: '2026-06-01T12:01:00Z',
      },
    ];
    mocks.rows.registrations = [{ id: 'registration-1', event_id: 'event-1' }];
    mocks.rows.events = [{ id: 'event-1', title: 'Summer Social' }];
    const { container, rerender } = render(await MemberPaymentsPage());
    expect(container).toHaveTextContent('Payment history');
    expect(container).toHaveTextContent('Summer Social');
    expect(container).toHaveTextContent('payment-1');

    mocks.errors['payments.rows'] = { message: 'database detail' };
    rerender(await MemberPaymentsPage());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Payment history is temporarily unavailable.',
    );
  });

  it('shows the empty state when no payment rows exist', async () => {
    render(await MemberPaymentsPage());
    expect(screen.getByText('No payments found.')).toBeInTheDocument();
  });
});

describe('admin payment history page', () => {
  it('guards anonymous and non-admin users', async () => {
    mocks.user = null;
    await expect(AdminPaymentsPage()).rejects.toThrow('redirect:/login?next=/admin/payments');
    mocks.user = { id: 'member-1' };
    mocks.profile = { role: 'member', application_status: 'approved' };
    await expect(AdminPaymentsPage()).rejects.toThrow('redirect:/member/dashboard');
  });

  it('joins payment records to event and user details and refreshes missing proceeds', async () => {
    mocks.rows.payments = [
      {
        id: 'payment-1',
        user_id: 'member-1',
        provider: 'stripe',
        purpose: 'event_registration',
        business_record_id: 'registration-1',
        amount_minor: 2500,
        currency: 'cad',
        status: 'succeeded',
        refunded_amount_minor: 0,
        created_at: '2026-06-01T12:00:00Z',
        succeeded_at: '2026-06-01T12:01:00Z',
        stripe_payment_intent_id: 'pi-1',
        stripe_fee_minor: null,
        proceeds_minor: null,
      },
    ];
    mocks.rows.profiles = [
      { id: 'member-1', full_name: 'Alex Member', email: 'alex@example.test' },
    ];
    mocks.rows.registrations = [{ id: 'registration-1', event_id: 'event-1' }];
    mocks.rows.events = [{ id: 'event-1', title: 'Summer Social' }];
    mocks.syncPaymentProceeds.mockResolvedValue({ feeMinor: 100, proceedsMinor: 2400 });
    const { container } = render(await AdminPaymentsPage());
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Stripe' }));
    expect(container).toHaveTextContent('Alex Member');
    expect(container).toHaveTextContent('Summer Social');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Report' }));
    expect(container).toHaveTextContent('$24.00');
    expect(mocks.syncPaymentProceeds).toHaveBeenCalledWith(expect.any(Object), 'payment-1', 'pi-1');
  });

  it('handles empty and failed payment history and joins tournament registrations', async () => {
    mocks.singles.payment_method_settings = {
      interac_enabled: true,
      interac_recipient_email: 'payments@example.test',
      interac_instructions: 'Include your name.',
    };
    const emptyPage = render(await AdminPaymentsPage());
    expect(emptyPage.container).toHaveTextContent('Payments');
    expect(emptyPage.container).not.toHaveTextContent('Could not load payments.');
    emptyPage.unmount();

    mocks.errors['payments.rows'] = { message: 'database detail' };
    const failedPage = render(await AdminPaymentsPage());
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load payments.');
    failedPage.unmount();

    mocks.errors = {};
    mocks.rows.payments = [
      {
        id: 'tournament-payment',
        user_id: 'member-1',
        provider: null,
        purpose: 'tournament_registration',
        business_record_id: ', participant-a, participant-b, ',
        amount_minor: 3000,
        currency: 'cad',
        status: 'pending',
        manual_review_status: null,
        refunded_amount_minor: 500,
        created_at: '2026-06-01T12:00:00Z',
        succeeded_at: null,
        stripe_payment_intent_id: null,
        stripe_fee_minor: null,
        proceeds_minor: null,
      },
      {
        id: 'unlinked-payment',
        user_id: 'missing-user',
        provider: 'manual',
        purpose: 'membership',
        business_record_id: null,
        amount_minor: 1000,
        currency: 'cad',
        status: 'succeeded',
        manual_review_status: 'approved',
        refunded_amount_minor: 0,
        created_at: '2026-05-01T12:00:00Z',
        succeeded_at: null,
        stripe_payment_intent_id: null,
        stripe_fee_minor: null,
        proceeds_minor: 1000,
      },
    ];
    mocks.rows.profiles = [{ id: 'member-1', full_name: 'Alex Member', email: null }];
    mocks.rows.tournament_participants = [{ id: 'participant-b', event_id: 'event-tournament' }];
    mocks.rows.events = [{ id: 'event-tournament', title: 'Summer Cup' }];
    const { container } = render(await AdminPaymentsPage());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Stripe' }));
    expect(container).toHaveTextContent('Alex Member');
    await user.click(screen.getByRole('tab', { name: 'Interac' }));
    expect(screen.getByLabelText('Recipient email')).toHaveValue('payments@example.test');
  });
});

describe('member chat page', () => {
  it('redirects anonymous and unapproved visitors, then mounts chat for approved members', async () => {
    mocks.user = null;
    await expect(MemberChatPage()).rejects.toThrow('redirect:/login?next=/member/chat');
    mocks.user = { id: 'member-1' };
    mocks.profile = { application_status: 'pending' };
    await expect(MemberChatPage()).rejects.toThrow('redirect:/member/dashboard');
    mocks.profile = { application_status: 'approved' };
    mocks.singles.club_settings = { club_name: 'PCTC', short_name: 'Club' };
    const { container } = render(await MemberChatPage());
    expect(container).toHaveTextContent('Chat for member-1');
  });
});
