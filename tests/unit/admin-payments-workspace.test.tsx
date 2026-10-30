import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
  usePathname: () => '/admin/payments',
  useSearchParams: () => new URLSearchParams(),
}));

import { AdminPaymentsWorkspace } from '@/components/admin-payments-workspace';

const initialSettings = {
  interac_enabled: false,
  interac_recipient_email: 'payments@example.test',
  interac_instructions: 'Use your name as the transfer note.',
};

const rows = [
  {
    id: 'interac-submitted',
    provider: 'interac',
    purpose: 'membership',
    eventName: null,
    amountMinor: 15000,
    currency: 'cad',
    status: 'pending',
    manualReviewStatus: 'submitted',
    refundedAmountMinor: 0,
    feeMinor: null,
    proceedsMinor: null,
    createdAt: '2026-10-01T12:00:00Z',
    succeededAt: null,
    userName: 'Alex Member',
    userEmail: 'alex@example.test',
    refundable: false,
  },
  {
    id: 'interac-paid',
    provider: 'interac',
    purpose: 'membership',
    eventName: null,
    amountMinor: 15000,
    currency: 'cad',
    status: 'succeeded',
    manualReviewStatus: 'confirmed',
    refundedAmountMinor: 0,
    feeMinor: null,
    proceedsMinor: null,
    createdAt: '2026-10-02T12:00:00Z',
    succeededAt: '2026-10-02T12:00:00Z',
    userName: null,
    userEmail: null,
    refundable: false,
  },
];

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.replace.mockReset();
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWorkspace() {
  return render(<AdminPaymentsWorkspace rows={rows} initialSettings={initialSettings} />);
}

describe('AdminPaymentsWorkspace', () => {
  it('saves Interac settings and presents server errors', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Interac' }));
    expect(mocks.replace).toHaveBeenCalledWith('/admin/payments?tab=interac', { scroll: false });
    await user.click(screen.getByRole('checkbox', { name: 'Enable Interac payments' }));
    await user.clear(screen.getByRole('textbox', { name: 'Recipient email' }));
    await user.type(screen.getByRole('textbox', { name: 'Recipient email' }), 'new@example.test');
    await user.clear(screen.getByRole('textbox', { name: 'Instructions' }));
    await user.type(screen.getByRole('textbox', { name: 'Instructions' }), 'Transfer details');
    await user.click(screen.getByRole('button', { name: 'Save instructions' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Interac settings saved.');
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body))).toEqual({
      enabled: true,
      recipientEmail: 'new@example.test',
      instructions: 'Transfer details',
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Settings unavailable.' }),
    });
    await user.click(screen.getByRole('button', { name: 'Save instructions' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Settings unavailable.');
  });

  it('confirms and retries a failed payment review, and requires a rejection note', async () => {
    const user = userEvent.setup();
    mocks.fetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Review unavailable.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Interac' }));
    expect(screen.getByText('Unknown user')).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: 'Confirm payment' });
    await user.click(confirmButtons[0]);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Confirm Interac payment?');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review unavailable.');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm payment' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(JSON.parse(String(mocks.fetch.mock.calls[1][1]?.body))).toMatchObject({
      paymentId: 'interac-submitted',
      action: 'confirm',
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();

    const note = screen.getByRole('textbox', { name: 'Review note for interac-submitted' });
    const rejectButton = screen.getByRole('button', { name: 'Reject payment' });
    expect(rejectButton).toBeDisabled();
    await user.type(note, 'No matching transfer');
    expect(rejectButton).toBeEnabled();
    await user.click(rejectButton);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('A reason is required.');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('exports quoted payment data as a downloadable CSV', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:payments');
    const revokeObjectURL = vi.fn();
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    let downloadName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    try {
      render(
        <AdminPaymentsWorkspace
          rows={[
            ...rows,
            {
              ...rows[0],
              id: 'quoted-payment',
              userName: 'Member "A"',
              userEmail: 'quoted@example.test',
            },
          ]}
          initialSettings={initialSettings}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Export all' }));

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:payments');
      expect(click).toHaveBeenCalledOnce();
      expect(downloadName).toMatch(/^pctc-payments-all-\d{4}-\d{2}-\d{2}\.csv$/);
      const csv = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(createObjectURL.mock.calls[0][0]);
      });
      expect(csv).toContain('"Payment ID","Created At","Provider"');
      expect(csv).toContain('"Member ""A"""');
    } finally {
      click.mockRestore();
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
      else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
      else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it('completes a successful review and sends a rejection note to the review API', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Interac' }));
    await user.click(screen.getAllByRole('button', { name: 'Confirm payment' })[0]);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm payment' }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body))).toMatchObject({
      paymentId: 'interac-submitted',
      action: 'confirm',
    });

    await user.type(
      screen.getByRole('textbox', { name: 'Review note for interac-submitted' }),
      'No matching transfer',
    );
    await user.click(screen.getByRole('button', { name: 'Reject payment' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reject payment' }),
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(mocks.fetch.mock.calls[1][1]?.body))).toMatchObject({
      paymentId: 'interac-submitted',
      action: 'reject',
      note: 'No matching transfer',
    });
  });

  it('filters transactions by search, purpose, status, amount, and date, then clears filters', async () => {
    const user = userEvent.setup();
    render(
      <AdminPaymentsWorkspace
        rows={[
          ...rows,
          {
            id: 'event-refund',
            provider: 'interac',
            purpose: 'event_registration',
            eventName: 'Summer Open',
            amountMinor: 5000,
            currency: 'cad',
            status: 'partially_refunded',
            manualReviewStatus: 'confirmed',
            refundedAmountMinor: 1000,
            feeMinor: null,
            proceedsMinor: null,
            createdAt: '2026-10-03T12:00:00Z',
            succeededAt: '2026-10-03T12:00:00Z',
            userName: 'Jordan Guest',
            userEmail: 'jordan@example.test',
            refundable: false,
          },
        ]}
        initialSettings={initialSettings}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Interac' }));
    expect(screen.getByText('Showing 3 Interac transactions.')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Name, email, event, payment ID'), 'Jordan');
    expect(screen.getByText('Showing 1 Interac transactions.')).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Name, email, event, payment ID'));

    await user.selectOptions(screen.getByLabelText('Purpose'), 'Summer Open');
    expect(screen.getByText('Showing 1 Interac transactions.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Payment status'), 'partially_refunded');
    expect(screen.getByText('Showing 1 Interac transactions.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Minimum amount ($)'));
    await user.type(screen.getByLabelText('Minimum amount ($)'), '60');
    expect(screen.getByText('No transactions found.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Showing 3 Interac transactions.')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Name, email, event, payment ID'), 'event-refund');
    await user.clear(screen.getByLabelText('From date'));
    await user.type(screen.getByLabelText('From date'), '2026-10-04');
    expect(screen.getByText('No transactions found.')).toBeInTheDocument();
  });
});
