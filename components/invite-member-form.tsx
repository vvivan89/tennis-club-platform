'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { FloatingFeedback } from '@/components/floating-feedback';
import { useState, type FormEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatPhoneNumber } from '@/lib/format-phone';
import { Button } from '@/components/ui/button';
import { GenderSelect } from '@/components/gender-select';
import { TennisSkillLevelSelect } from '@/components/tennis-skill-level-select';
export function InviteMemberForm() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const form = e.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch('/api/admin/invite-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        const reason = typeof result.error === 'string' ? result.error : 'Invitation failed.';
        console.error('[Member invitation] Email/API failure', {
          status: response.status,
          error: reason,
        });
        throw new Error(reason);
      }
      setMessage(
        `Invitation sent to ${String(payload.email)}. They must follow the email link to confirm and finish setting up their account.`,
      );
      form.reset();
    } catch (err) {
      console.error('[Member invitation] Request failed', err);
      setError(err instanceof Error ? err.message : 'Could not send invitation. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Add a member</CardTitle>
          <CardDescription>
            Send an invitation email. The member must follow the link to confirm their account.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide form' : 'Invite member'}
        </Button>
      </CardHeader>
      {open && (
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Full name <span className="text-destructive">*</span>
              <Input name="full_name" required maxLength={200} />
            </label>
            <label className="space-y-1 text-sm">
              Email <span className="text-destructive">*</span>
              <Input name="email" type="email" required maxLength={320} />
            </label>
            <label className="space-y-1 text-sm">
              Phone <span className="text-destructive">*</span>
              <Input
                name="phone"
                type="tel"
                required
                maxLength={80}
                onBlur={(e) => {
                  e.currentTarget.value = formatPhoneNumber(e.currentTarget.value);
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              Date of birth <span className="text-destructive">*</span>
              <Input
                name="date_of_birth"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>
            <GenderSelect
              name="gender"
              defaultValue=""
              className="space-y-1 text-sm"
              selectClassName="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <TennisSkillLevelSelect
              label="Tennis skill rating"
              name="tennis_skill_level"
              defaultValue="2.5"
              className="space-y-1 text-sm"
              selectClassName="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <div className="sm:col-span-2">
              <Button disabled={busy}>
                {busy ? (
                  <TennisLoader compact label="Sending invitation" />
                ) : (
                  'Send invitation email'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
      <FloatingFeedback error={error} message={message} />
    </Card>
  );
}
