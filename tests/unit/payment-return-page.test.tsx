import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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
    expect(screen.getByRole('button', { name: 'Return' })).toBeEnabled();
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

  it.each([
    ['canceled', 'Payment canceled'],
    ['refunded', 'Payment refunded'],
    ['partially_refunded', 'Payment refunded'],
    ['processing', 'Payment processing'],
  ])('renders the %s status state', async (status, heading) => {
    mocks.params = 'payment_id=payment-1';
    vi.mocked(fetch).mockResolvedValue(statusResponse(status));
    render(<PaymentReturnPage />);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('describes a confirmed tournament payment and supports failed status requests', async () => {
    mocks.params = 'session_id=cs_tournament';
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          payment: {
            id: 'payment-2',
            purpose: 'tournament_registration',
            amount_minor: 1200,
            currency: 'cad',
            status: 'succeeded',
          },
          fulfilled: true,
        }),
        { status: 200 },
      ),
    );
    render(<PaymentReturnPage />);
    expect(await screen.findByText(/applied to your tournament registration/)).toBeInTheDocument();
    cleanup();

    vi.mocked(fetch).mockRejectedValueOnce('network unavailable');
    render(<PaymentReturnPage />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not retrieve payment status.',
    );
  });

  it('reports guest checkout cancellation and preserves the safe return destination', async () => {
    mocks.params =
      'canceled=1&payment_id=guest-payment&return_to=%2Fmy-events%3Fguest_payment_ids%3Da%252Cb';
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ provisionalRegistrationRemoved: true }), { status: 200 }),
    );
    render(<PaymentReturnPage />);
    expect(
      await screen.findByText(/provisional tournament registration was removed/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(fetch).toHaveBeenCalledWith(
      '/api/payments/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paymentId: 'guest-payment', explicitCancel: true }),
      }),
    );
  });

  it('keeps guest registration when cancellation cannot be verified', async () => {
    mocks.params = 'canceled=1&payment_id=guest-payment';
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    render(<PaymentReturnPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled());
    expect(screen.getAllByRole('status')[1]).toHaveTextContent(
      'payment state could not be verified',
    );
  });
});
