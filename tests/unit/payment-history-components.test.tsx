import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    channel: () => ({ on: () => ({ subscribe: vi.fn() }) }),
    removeChannel: vi.fn(),
  }),
}));

import { PaymentHistoryTable } from '@/components/payment-history-table';
import { AdminPaymentRefundForm } from '@/components/admin-payment-refund-form';
import { AdminManualPaymentRefundForm } from '@/components/admin-manual-payment-refund-form';

const rows = [
  {
    id: 'payment-1',
    purpose: 'event_registration',
    eventName: 'Summer Social',
    amountMinor: 2500,
    currency: 'cad',
    status: 'succeeded',
    refundedAmountMinor: 500,
    proceedsMinor: 1900,
    createdAt: '2026-06-01T12:00:00Z',
    succeededAt: '2026-06-02T12:00:00Z',
    userName: 'Alex Member',
    userEmail: 'alex@example.test',
    refundable: true,
  },
  {
    id: 'payment-2',
    purpose: 'membership',
    eventName: null,
    amountMinor: 15000,
    currency: 'cad',
    status: 'pending',
    refundedAmountMinor: 0,
    proceedsMinor: null,
    createdAt: '2026-06-10T12:00:00Z',
    succeededAt: null,
    userName: 'Jordan Member',
    userEmail: 'jordan@example.test',
    refundable: false,
  },
];

beforeEach(() => {
  routerRefresh.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PaymentHistoryTable', () => {
  it('renders member history, filters by purpose and amount, and handles empty results', async () => {
    const user = userEvent.setup();
    render(<PaymentHistoryTable rows={rows} />);
    expect(screen.getByText('Showing 2 of 2 payments')).toBeInTheDocument();
    expect(screen.getByText('payment-1')).toBeInTheDocument();
    expect(screen.getAllByText('Summer Social')).toHaveLength(2);
    expect(screen.queryByText('Alex Member')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Purpose' }), 'Summer Social');
    expect(screen.getByText('Showing 1 of 2 payments')).toBeInTheDocument();
    expect(screen.getByText('payment-1')).toBeInTheDocument();
    expect(screen.queryByText('payment-2')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Minimum amount'));
    await user.type(screen.getByLabelText('Minimum amount'), '30');
    expect(screen.getByText('No payments match these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Showing 2 of 2 payments')).toBeInTheDocument();
  });

  it('filters admin history by person, status, and dates, with proceeds and refund actions', async () => {
    const user = userEvent.setup();
    render(<PaymentHistoryTable rows={rows} admin />);
    expect(screen.getByText('Proceeds')).toBeInTheDocument();
    expect(screen.getByText('Refund action')).toBeInTheDocument();
    expect(screen.getByText('Alex Member')).toBeInTheDocument();
    expect(screen.getByText('Jordan Member')).toBeInTheDocument();
    expect(screen.queryByText('Unknown user')).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search user or event' }), 'jordan');
    expect(screen.getByText('Showing 1 of 2 payments')).toBeInTheDocument();
    expect(screen.getByText('Jordan Member')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search user or event' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Payment status' }), 'succeeded');
    expect(screen.getByText('Alex Member')).toBeInTheDocument();
    expect(screen.queryByText('Jordan Member')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('From date'));
    await user.type(screen.getByLabelText('From date'), '2026-06-05');
    expect(screen.getByText('No payments match these filters.')).toBeInTheDocument();
  });
});

describe('AdminPaymentRefundForm', () => {
  it('disables invalid amounts and submits a valid partial refund', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'succeeded' }), { status: 200 }),
    );
    render(<AdminPaymentRefundForm paymentId="payment-1" remainingMinor={2500} />);
    const amount = screen.getByRole('spinbutton', { name: 'Refund amount for payment-1' });
    const submit = screen.getByRole('button', { name: 'Request refund for payment-1' });
    expect(submit).not.toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '30');
    expect(submit).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '12.34');
    await user.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      paymentId: 'payment-1',
      amountMinor: 1234,
      reason: 'requested_by_customer',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Refund requested (succeeded)');
    expect(routerRefresh).toHaveBeenCalledOnce();
    expect(amount).toHaveValue(25);
  });

  it('submits the full remainder when blank and shows server errors', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'refunded' }), { status: 200 }),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <AdminPaymentRefundForm paymentId="payment-2" remainingMinor={1000} />,
    );
    await user.click(screen.getByRole('button', { name: 'Request refund for payment-2' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(
      expect.objectContaining({ paymentId: 'payment-2' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      amountMinor: 1000,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Refund unavailable' }), { status: 409 }),
    );
    rerender(<AdminPaymentRefundForm paymentId="payment-3" remainingMinor={1000} />);
    await user.click(screen.getByRole('button', { name: 'Request refund for payment-3' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Refund unavailable');
  });

  it('uses the default error for an empty API error and a non-Error network failure', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 503 }))
      .mockRejectedValueOnce('network failure');
    const { rerender } = render(
      <AdminPaymentRefundForm paymentId="payment-fallback" remainingMinor={1000} />,
    );
    await user.click(screen.getByRole('button', { name: 'Request refund for payment-fallback' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Refund request failed.');

    rerender(<AdminPaymentRefundForm paymentId="payment-network" remainingMinor={1000} />);
    await user.click(screen.getByRole('button', { name: 'Request refund for payment-network' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Refund request failed.');
  });
});

describe('AdminManualPaymentRefundForm', () => {
  it('requires confirmation, submits the refund, and reports server errors', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ amountMinor: 1250, currency: 'cad' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Manual ledger unavailable.' }), { status: 503 }),
      );
    const { rerender } = render(
      <AdminManualPaymentRefundForm paymentId="interac-1" remainingMinor={2500} />,
    );
    const amount = screen.getByRole('spinbutton', { name: 'Manual refund amount for interac-1' });
    await user.clear(amount);
    await user.type(amount, '12.50');
    await user.type(screen.getByLabelText('Manual refund note for interac-1'), ' member request ');
    await user.click(screen.getByRole('button', { name: 'Record manual refund for interac-1' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This records the refund in PCTC');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Record manual refund for interac-1' }));
    await user.click(screen.getByRole('button', { name: 'Record refund' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      paymentId: 'interac-1',
      amountMinor: 1250,
      note: 'member request',
      idempotencyKey: expect.any(String),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Refund recorded');
    expect(routerRefresh).toHaveBeenCalledOnce();

    rerender(<AdminManualPaymentRefundForm paymentId="interac-2" remainingMinor={1000} />);
    await user.click(screen.getByRole('button', { name: 'Record manual refund for interac-2' }));
    await user.click(screen.getByRole('button', { name: 'Record refund' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Manual ledger unavailable.');
  });

  it('omits an empty note and defaults a missing currency to CAD', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ amountMinor: 500, currency: null }), { status: 200 }),
    );
    render(<AdminManualPaymentRefundForm paymentId="interac-default" remainingMinor={500} />);
    await user.click(
      screen.getByRole('button', { name: 'Record manual refund for interac-default' }),
    );
    await user.click(screen.getByRole('button', { name: 'Record refund' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Refund recorded: $5.00.');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      paymentId: 'interac-default',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).note).toBeUndefined();
  });
});
