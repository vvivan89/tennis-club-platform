'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { registrationErrorMessage } from '@/lib/registration-error-message';
import { dispatchEventNotificationsInBackground } from '@/lib/event-notifications';
import { Button } from '@/components/ui/button';
import { EventWithdrawalDialog } from '@/components/event-withdrawal-dialog';
type CardEvent = {
  status: string;
  starts_at: string;
  registration_opens_at: string;
  registration_closes_at: string | null;
  gender_restriction: string | null;
};
type RegistrationStatus = 'confirmed' | 'waitlisted';
type Suspension = { starts_on: string; ends_on: string; reason: string };
export function EventCardActions({ eventId }: { eventId: string }) {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const operationKeys = useRef<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [approved, setApproved] = useState(false);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [event, setEvent] = useState<CardEvent | null>(null);
  const [suspension, setSuspension] = useState<Suspension | null>(null);
  const [showSuspension, setShowSuspension] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), 3000);
    return () => window.clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    let alive = true;
    async function load() {
      const [
        {
          data: { user },
        },
        { data: ev },
      ] = await Promise.all([
        db.auth.getUser(),
        db
          .from('events')
          .select(
            'status,starts_at,registration_opens_at,registration_closes_at,gender_restriction',
          )
          .eq('id', eventId)
          .maybeSingle(),
      ]);
      if (!alive) return;
      setEvent(ev);
      if (user) {
        const [{ data: profile }, { data: reg }, { data: sus }] = await Promise.all([
          db.from('profiles').select('application_status').eq('id', user.id).maybeSingle(),
          db
            .from('registrations')
            .select('id,status,created_at')
            .eq('event_id', eventId)
            .eq('user_id', user.id)
            .in('status', ['confirmed', 'waitlisted'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          db
            .from('member_suspensions')
            .select('starts_on,ends_on,reason')
            .eq('user_id', user.id)
            .is('cancelled_at', null)
            .lte(
              'starts_on',
              ev?.starts_at ? new Date(ev.starts_at).toLocaleDateString('en-CA') : '',
            )
            .gte('ends_on', ev?.starts_at ? new Date(ev.starts_at).toLocaleDateString('en-CA') : '')
            .limit(1),
        ]);
        if (alive) {
          setSignedIn(true);
          setApproved(profile?.application_status === 'approved');
          if (reg) {
            setRegistrationId(reg.id);
            setRegistrationStatus(reg.status as RegistrationStatus);
          }
          setSuspension(sus?.[0] ?? null);
        }
      }
      if (alive) setReady(true);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [db, eventId]);
  const now = Date.now();
  const open =
    !!event &&
    event.status === 'published' &&
    now >= new Date(event.registration_opens_at).getTime() &&
    (!event.registration_closes_at || now < new Date(event.registration_closes_at).getTime());
  const canWithdraw =
    !!event &&
    event.status === 'published' &&
    (!event.registration_closes_at || now < new Date(event.registration_closes_at).getTime());
  if (!ready || !signedIn || !approved || !event) return null;
  async function act(withdraw = false) {
    setBusy(true);
    setError('');
    setConfirmWithdraw(false);
    try {
      const operation = withdraw ? `withdraw:${registrationId}` : `register:${eventId}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      if (withdraw && registrationId) {
        const { error } = await db.rpc('withdraw_from_event', {
          p_registration_id: registrationId,
          p_idempotency_key: idempotencyKey,
        });
        if (error) {
          console.error('[Event registration] Database withdrawal failed', error);
          throw new Error('registration-update-failed');
        }
        setRegistrationId(null);
        setRegistrationStatus(null);
      } else {
        const { data, error } = await db.rpc('register_for_event', {
          p_event_id: eventId,
          p_idempotency_key: idempotencyKey,
        });
        if (error) {
          console.error('[Event registration] Database registration failed', error);
          throw error;
        }
        const reg = data?.[0];
        if (reg?.registration_id) {
          setRegistrationId(reg.registration_id);
          setRegistrationStatus(reg.registration_state as RegistrationStatus);
        }
      }
      delete operationKeys.current[operation];
      router.refresh();
      setBusy(false);
      dispatchEventNotificationsInBackground(eventId, 'Event registration');
    } catch (e) {
      console.error('[Event registration] Database update failed', e);
      setError(registrationErrorMessage(e, event?.gender_restriction ?? null));
    } finally {
      setBusy(false);
    }
  }
  const statusLabel =
    registrationStatus === 'confirmed'
      ? 'Registered'
      : registrationStatus === 'waitlisted'
        ? 'Waitlisted'
        : null;
  if (event.status !== 'published' && !registrationStatus) return null;
  if (!registrationStatus && !open) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      {suspension && !registrationId && (
        <div className="relative">
          <button
            type="button"
            aria-label="Suspension information"
            title="Suspension prevents registration"
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowSuspension((v) => !v);
            }}
          >
            <AlertCircle className="h-4 w-4" />
            Suspended
          </button>
          {showSuspension && (
            <div className="absolute right-0 top-6 z-20 w-64 rounded-md border border-red-300 bg-background p-3 text-left text-xs shadow-lg">
              <strong className="text-red-600">Registration blocked</strong>
              <p className="mt-1">
                Suspension: {suspension.starts_on} – {suspension.ends_on}
              </p>
              <p className="mt-1">{suspension.reason}</p>
            </div>
          )}
        </div>
      )}
      {statusLabel && (
        <span
          role="status"
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${registrationStatus === 'confirmed' ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300' : 'bg-violet-600/10 text-violet-700 dark:text-violet-300'}`}
        >
          {statusLabel}
        </span>
      )}
      {registrationId ? (
        canWithdraw && (
          <Button
            size="sm"
            variant="outline"
            className="border-red-500/70 text-red-700 hover:border-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirmWithdraw(true);
            }}
          >
            {busy ? <TennisLoader compact label="Working" /> : 'Withdraw'}
          </Button>
        )
      ) : (
        <Button
          size="sm"
          disabled={busy || !!suspension}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void act(false);
          }}
        >
          {busy ? <TennisLoader compact label="Working" /> : 'Register'}
        </Button>
      )}
      {error && (
        <span
          role="alert"
          className="fixed right-4 top-4 z-[100] max-w-80 rounded-md border border-destructive/30 bg-background p-3 text-sm text-destructive shadow-lg"
        >
          {error}
        </span>
      )}
      <EventWithdrawalDialog
        eventId={eventId}
        open={confirmWithdraw}
        busy={busy}
        stopPropagation
        onCancel={() => setConfirmWithdraw(false)}
        onConfirm={() => void act(true)}
      />
    </div>
  );
}
