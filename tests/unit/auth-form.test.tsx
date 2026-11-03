import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  next: '/member/dashboard',
  replace: vi.fn(),
  refresh: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => ({ get: () => mocks.next }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: mocks.signIn,
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.reset,
    },
    rpc: mocks.rpc,
  }),
}));

import { AuthForm } from '@/components/auth/auth-form';

beforeEach(() => {
  mocks.next = '/member/dashboard';
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mocks.reset.mockReset().mockResolvedValue({ error: null });
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

describe('AuthForm', () => {
  it('logs in, records the auth action, and honors the next destination', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByLabelText('Email'), 'member@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: 'member@example.com',
      password: 'password123',
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'record_client_audit_event',
      expect.objectContaining({ p_action: 'auth.sign_in' }),
    );
    expect(mocks.replace).toHaveBeenCalledWith('/member/dashboard');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('shows generic authentication feedback without exposing provider details', async () => {
    mocks.signIn.mockResolvedValue({ error: new Error('Invalid credentials') });
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByLabelText('Email'), 'member@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to sign in. Check your email and password and try again.',
    );
    expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('normalizes signup profile data and shows the pending-confirmation notice', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="signup" />);
    await user.type(screen.getByLabelText('Full name'), '  New Member  ');
    await user.type(screen.getByLabelText(/Phone number/), '6045550100');
    await user.selectOptions(screen.getByLabelText(/Tennis skill rating/), '3.5');
    await user.type(screen.getByLabelText(/Comment/), '  Please contact me  ');
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@example.com',
        password: 'password123',
        options: expect.objectContaining({
          data: {
            full_name: 'New Member',
            phone: '604.555.0100',
            tennis_skill_level: '3.5',
            application_comment: 'Please contact me',
            date_of_birth: null,
            gender: null,
          },
        }),
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('application will remain pending');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('redirects immediately when signup returns a session', async () => {
    mocks.signUp.mockResolvedValue({
      data: { session: { access_token: 'not displayed' } },
      error: null,
    });
    const user = userEvent.setup();
    render(<AuthForm mode="signup" />);
    await user.type(screen.getByLabelText('Full name'), 'New Member');
    await user.type(screen.getByLabelText(/Phone number/), '6045550100');
    await user.selectOptions(screen.getByLabelText(/Tennis skill rating/), '4.0');
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(mocks.replace).toHaveBeenCalledWith('/member/dashboard');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('requests a password reset without revealing whether an account exists', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="reset" />);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'member@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(mocks.reset).toHaveBeenCalledWith(
      'member@example.com',
      expect.objectContaining({
        redirectTo: expect.stringContaining('/auth/callback?next=/reset-password'),
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists');
  });
});
