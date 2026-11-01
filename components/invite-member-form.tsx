'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { FormFeedback } from '@/components/form-feedback';
import { useState, type FormEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatPhoneNumber } from '@/lib/format-phone';
import { Button } from '@/components/ui/button';
const levels = ['2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0'];
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
        console.error('[Member invitation] Email/API failure', { status: response.status, result });
        throw new Error('invitation-failed');
      }
      setMessage(
        `Invitation sent to ${String(payload.email)}. They must follow the email link to confirm and finish setting up their account.`,
      );
      form.reset();
    } catch (err) {
      console.error('[Member invitation] Request failed', err);
      setError('Could not send invitation. Please try again.');
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
              Full name
              <Input name="full_name" required maxLength={200} />
            </label>
            <label className="space-y-1 text-sm">
              Email
              <Input name="email" type="email" required maxLength={320} />
            </label>
            <label className="space-y-1 text-sm">
              Phone
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
              Tennis skill rating
              <select
                name="tennis_skill_level"
                required
                defaultValue="2.5"
                className="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {levels.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <FormFeedback error={error} message={message} className="mb-3" />
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
    </Card>
  );
}
