import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({ auth: { updateUser: mocks.updateUser } }),
}));
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));

import ResetPasswordPage from '@/app/reset-password/page';

beforeEach(() => {
  mocks.updateUser.mockReset().mockResolvedValue({ error: null });
  mocks.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reset password page', () => {
  it('updates the password and redirects to sign-in after the confirmation notice', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await user.type(screen.getByLabelText('New password'), 'secure-pass-123');
    fireEvent.submit(screen.getByLabelText('New password').closest('form') as HTMLFormElement);

    expect(
      await screen.findByText('Password updated. You can now sign in with your new password.'),
    ).toBeInTheDocument();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'secure-pass-123' });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login'), { timeout: 1800 });
  });

  it('shows a safe error when the password update is rejected', async () => {
    mocks.updateUser.mockResolvedValue({ error: new Error('provider detail') });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await user.type(screen.getByLabelText('New password'), 'another-pass-123');
    fireEvent.submit(screen.getByLabelText('New password').closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update password. Please try again.',
    );
    expect(screen.queryByText('provider detail')).not.toBeInTheDocument();
  });
});
