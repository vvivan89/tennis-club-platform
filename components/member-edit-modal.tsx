'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { FloatingFeedback } from '@/components/floating-feedback';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { requireBrowserUser } from '@/lib/supabase-browser-user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';

export type SuspensionRecord = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string;
  created_at: string;
  cancelled_at?: string | null;
};
export function MemberEditModal({
  member,
  onClose,
}: {
  member: {
    id: string;
    full_name: string;
    email: string;
    role?: string;
    admin_comment: string;
    suspensions: SuspensionRecord[];
  };
  onClose: () => void;
}) {
  const router = useRouter();
  const [comment, setComment] = useState(member.admin_comment);
  const [role, setRole] = useState(member.role || 'member');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reason, setReason] = useState('');
  const [editingSuspensionId, setEditingSuspensionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removeSuspensionId, setRemoveSuspensionId] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, onClose]);
  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { db, user } = await requireBrowserUser('Sign in again to continue.');
      const note = await db.from('member_admin_notes').upsert(
        {
          user_id: member.id,
          comment: comment.trim(),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (note.error) throw note.error;
      if (startsOn || endsOn || reason.trim()) {
        if (!startsOn || !endsOn || !reason.trim())
          throw new Error('To add a suspension, provide a start date, end date, and reason.');
        if (endsOn < startsOn)
          throw new Error('The suspension end date must be on or after its start date.');
        const suspension = editingSuspensionId
          ? await db
              .from('member_suspensions')
              .update({
                starts_on: startsOn,
                ends_on: endsOn,
                reason: reason.trim(),
                cancelled_at: null,
                cancelled_by: null,
              })
              .eq('id', editingSuspensionId)
              .eq('user_id', member.id)
          : await db.from('member_suspensions').insert({
              user_id: member.id,
              starts_on: startsOn,
              ends_on: endsOn,
              reason: reason.trim(),
              created_by: user.id,
            });
        if (suspension.error) throw suspension.error;
      }
      if (member.id !== currentUserId) {
        const roleUpdate = await db.from('profiles').update({ role }).eq('id', member.id);
        if (roleUpdate.error) throw roleUpdate.error;
      }
      setMessage('Member details saved.');
      router.refresh();
      onClose();
    } catch (e) {
      console.error('[Member admin] Member update failed', e);
      setError('Could not save member details. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function removeSuspension(id: string) {
    setBusy(true);
    setError('');
    try {
      const { db } = await requireBrowserUser('Sign in again to continue.');
      const result = await db
        .from('member_suspensions')
        .delete()
        .eq('id', id)
        .eq('user_id', member.id);
      if (result.error) throw result.error;
      router.refresh();
      onClose();
    } catch (e) {
      console.error('[Member admin] Suspension update failed', e);
      setError('Could not remove suspension. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-edit-title"
        className="my-8 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="member-edit-title" className="text-xl font-semibold">
              Edit member
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{member.full_name || member.email}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
        <div className="mt-6 space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="member-role">
              Role
            </label>
            <select
              id="member-role"
              value={role}
              disabled={member.id === currentUserId}
              onChange={(e) => setRole(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="member">Member</option>
              <option value="organizer">Organizer</option>
              <option value="admin">Admin</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {member.id === currentUserId
                ? 'You cannot change your own role.'
                : 'Organizers can manage events only. Admins can manage all club settings and members.'}
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="admin-comment">
              Administrator comment
            </label>
            <textarea
              id="admin-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={10000}
              placeholder="Internal notes about this member…"
              className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">Visible to administrators only.</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <h3 className="font-semibold">
              {editingSuspensionId ? 'Edit suspension' : 'Add suspension'}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Members cannot register for events during an active suspension. Removing a suspension
              permanently deletes it from history.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                Date from
                <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                Date to
                <Input
                  type="date"
                  min={startsOn || today}
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </label>
            </div>
            <label className="mt-3 block space-y-1 text-sm">
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
                placeholder="Reason for suspension"
                className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <Button type="button" onClick={() => void save()} disabled={busy}>
                {busy ? (
                  <TennisLoader compact label="Saving" />
                ) : editingSuspensionId ? (
                  'Save suspension'
                ) : (
                  'Add suspension'
                )}
              </Button>
              {editingSuspensionId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setEditingSuspensionId(null);
                    setStartsOn('');
                    setEndsOn('');
                    setReason('');
                  }}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </div>
          <div>
            <h3 className="font-semibold">Suspension history</h3>
            {member.suspensions.length ? (
              <div className="mt-3 space-y-2">
                {[...member.suspensions]
                  .sort((a, b) => b.starts_on.localeCompare(a.starts_on))
                  .map((s) => {
                    const active = !s.cancelled_at && s.starts_on <= today && s.ends_on >= today;
                    return (
                      <div key={s.id} className="rounded-lg border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong>
                            {formatDate(s.starts_on)} – {formatDate(s.ends_on)}
                          </strong>
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                active ? 'font-medium text-destructive' : 'text-muted-foreground'
                              }
                            >
                              {active ? 'Active' : s.ends_on < today ? 'Ended' : 'Scheduled'}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setEditingSuspensionId(s.id);
                                setStartsOn(s.starts_on);
                                setEndsOn(s.ends_on);
                                setReason(s.reason);
                                setError('');
                                setMessage('');
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              onClick={() => setRemoveSuspensionId(s.id)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                        <p className="mt-1 text-muted-foreground">{s.reason}</p>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No previous suspensions.</p>
            )}
          </div>
          <FloatingFeedback error={error} message={message} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? <TennisLoader compact label="Saving" /> : 'Save changes'}
            </Button>
          </div>
        </div>
      </section>
      {removeSuspensionId && (
        <ConfirmDialog
          open
          title="Remove suspension history?"
          description="Permanently remove this suspension from the member’s history?"
          confirmLabel="Remove suspension"
          destructive
          onCancel={() => setRemoveSuspensionId(null)}
          onConfirm={() => {
            const id = removeSuspensionId;
            setRemoveSuspensionId(null);
            void removeSuspension(id);
          }}
        />
      )}
    </div>
  );
}
function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-CA');
}
