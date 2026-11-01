'use client';
import { TennisLoader } from '@/components/tennis-loader';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { formatPhoneNumber } from '@/lib/format-phone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Mode = 'login' | 'signup' | 'reset';

const copy = {
  login: {
    title: 'Member sign in',
    description: 'Sign in to access your PCTC member account.',
    submit: 'Sign in',
  },
  signup: {
    title: 'Create a member account',
    description: 'Create an account to begin your PCTC membership application.',
    submit: 'Create account',
  },
  reset: {
    title: 'Reset your password',
    description: 'We will email you a password-reset link.',
    submit: 'Send reset link',
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [tennisSkillLevel, setTennisSkillLevel] = useState('');
  const [phone, setPhone] = useState('');
  const [applicationComment, setApplicationComment] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const config = copy[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setError('');
    setBusy(true);

    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        await supabase.rpc('record_client_audit_event', {
          p_action: 'auth.sign_in',
          p_summary: 'User signed in',
          p_route: window.location.pathname,
          p_source: 'web',
          p_metadata: {},
        });
        router.replace(safeRedirectPath(searchParams.get('next'), '/member/dashboard'));
        router.refresh();
      } else if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              phone: formatPhoneNumber(phone.trim()),
              tennis_skill_level: tennisSkillLevel,
              application_comment: applicationComment.trim(),
            },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/member/dashboard`,
          },
        });
        if (authError) throw authError;
        if (data.session) {
          router.replace('/member/dashboard');
          router.refresh();
        } else {
          setNotice(
            'Account created. Check your email for a confirmation link. Your application will remain pending until an administrator approves it.',
          );
        }
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (authError) throw authError;
        setNotice('If an account exists for that address, a password-reset email has been sent.');
      }
    } catch {
      setError(
        mode === 'login'
          ? 'Unable to sign in. Check your email and password and try again.'
          : mode === 'signup'
            ? 'Could not create account. Please check your details and try again.'
            : 'Could not send the password-reset email. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">{config.title}</CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <label className="block space-y-1.5 text-sm font-medium">
                  Full name
                  <Input
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    maxLength={120}
                  />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  Phone number <span className="text-destructive">*</span>
                  <Input
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={() => setPhone((v) => formatPhoneNumber(v))}
                    required
                    maxLength={40}
                  />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  Tennis skill rating <span className="text-destructive">*</span>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={tennisSkillLevel}
                    onChange={(e) => setTennisSkillLevel(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select your rating
                    </option>
                    {Array.from({ length: 10 }, (_, i) => (2.5 + i * 0.5).toFixed(1)).map(
                      (level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  Comment (optional)
                  <textarea
                    value={applicationComment}
                    onChange={(e) => setApplicationComment(e.target.value)}
                    maxLength={3000}
                    placeholder="Tell the club why you would like to join…"
                    className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm font-normal"
                  />
                </label>
              </>
            )}
            <label className="block space-y-1.5 text-sm font-medium">
              Email
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </label>
            {mode !== 'reset' && (
              <label className="block space-y-1.5 text-sm font-medium">
                Password
                <Input
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                />
                {mode === 'signup' && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    Use at least 8 characters.
                  </span>
                )}
              </label>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
                {notice}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? <TennisLoader compact label="Please wait" /> : config.submit}
            </Button>
          </form>
          <div className="mt-5 flex flex-col gap-2 text-sm text-muted-foreground">
            {mode === 'login' && (
              <>
                <Link className="hover:text-foreground" href="/forgot-password">
                  Forgot password?
                </Link>
                <p>
                  Need an account?{' '}
                  <Link className="font-medium text-primary" href="/signup">
                    Create one
                  </Link>
                </p>
              </>
            )}
            {mode === 'signup' && (
              <p>
                Already registered?{' '}
                <Link className="font-medium text-primary" href="/login">
                  Sign in
                </Link>
              </p>
            )}
            {mode === 'reset' && (
              <p>
                Remembered your password?{' '}
                <Link className="font-medium text-primary" href="/login">
                  Sign in
                </Link>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
