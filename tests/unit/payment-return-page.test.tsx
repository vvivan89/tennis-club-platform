import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ params: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.params),
}));

import PaymentReturnPage from '@/app/payments/return/page';

beforeEach(() => {
  mocks.params = '';
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function statusResponse(paymentStatus: string, fulfilled = false) {
  return new Response(
    JSON.stringify({
      payment: {
        id: 'payment-1',
        purpose: 'membership',
        amount_minor: 22000,
        currency: 'cad',
        status: paymentStatus,
        succeeded_at: '2026-06-01T12:00:00Z',
      },
      fulfilled,
    }),
    { status: 200 },
  );
}

describe('payment return page', () => {
  it('renders a canceled return and rejects unsafe return URLs', () => {
    mocks.params = 'canceled=1&return_to=%2F%2Fevil.example&return_label=Return';
    render(<PaymentReturnPage />);
    expect(screen.getByRole('heading', { name: 'Checkout canceled' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return' })).toHaveAttribute('href', '/member/payments');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the failed-payment status and queries by payment ID', async () => {
    mocks.params = 'payment_id=payment-1';
    vi.mocked(fetch).mockResolvedValue(statusResponse('failed'));
    render(<PaymentReturnPage />);
    expect(await screen.findByRole('heading', { name: 'Payment failed' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/payments/status?payment_id=payment-1', {
      cache: 'no-store',
    });
  });

  it('shows a successful fulfilled payment and amount', async () => {
    mocks.params = 'session_id=cs_success';
    vi.mocked(fetch).mockResolvedValue(statusResponse('succeeded', true));
    render(<PaymentReturnPage />);
    expect(await screen.findByRole('heading', { name: 'Payment successful' })).toBeInTheDocument();
    expect(screen.getByText('$220.00')).toBeInTheDocument();
    expect(screen.getByText('payment-1')).toBeInTheDocument();
  });

  it('shows server errors and keeps unfulfilled successful payments pending', async () => {
    mocks.params = 'payment_id=payment-1';
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Payment not found.' }), { status: 404 }),
    );
    render(<PaymentReturnPage />);
    expect(await screen.findByRole('status')).toHaveTextContent('Payment not found.');
    cleanup();

    vi.mocked(fetch).mockResolvedValue(statusResponse('succeeded', false));
    render(<PaymentReturnPage />);
    expect(
      await screen.findByRole('heading', { name: 'Payment confirmed — finalizing' }),
    ).toBeInTheDocument();
  });
});