'use client';
import { useState } from 'react';
import { TennisLoader } from '@/components/tennis-loader';
import { FloatingFeedback } from '@/components/floating-feedback';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
export type ApplicationRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  tennis_skill_level: string | null;
  application_comment: string;
  created_at: string;
};
export function AdminApplications({ applications }: { applications: ApplicationRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function act(id: string, action: 'approve' | 'dismiss') {
    setBusy(id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, action }),
      });
      const result = await response.json();
      if (!response.ok) {
        console.error('[Applications] Database/API update failed', {
          status: response.status,
          result,
        });
        throw new Error('application-update-failed');
      }
      if (action === 'approve' && !result.emailSent)
        console.error('[Applications] Approval email failed', result);
      setMessage(
        action === 'approve'
          ? result.emailSent
            ? 'Application approved. An email notification was queued.'
            : 'Application approved.'
          : 'Application dismissed.',
      );
      router.refresh();
    } catch (e) {
      console.error('[Applications] Update failed', e);
      setError('Could not update application. Please try again.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4">
      <FloatingFeedback error={error} message={message} />
      {applications.length ? (
        applications.map((a) => (
          <article key={a.id} className="rounded-xl border border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">{a.full_name || 'Name not provided'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {a.email} · {a.phone} · Rating {a.tennis_skill_level || '—'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Applied {new Date(a.created_at).toLocaleString('en-CA')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button disabled={!!busy} onClick={() => void act(a.id, 'approve')}>
                  {busy === a.id ? <TennisLoader compact label="Approving" /> : 'Approve'}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void act(a.id, 'dismiss')}
                >
                  Dismiss
                </Button>
              </div>
            </div>
            <div className="mt-4 rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
              {a.application_comment || 'No comment provided.'}
            </div>
          </article>
        ))
      ) : (
        <p className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
          There are no pending applications.
        </p>
      )}
    </div>
  );
}
