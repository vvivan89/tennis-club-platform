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
  slug: string | null;
  status: string;
  starts_at: string;
  registration_opens_at: string;
  registration_closes_at: string | null;
  gender_restriction: string | null;
  price_cents: number;
  allow_plus_one: boolean;
  event_type: string;
  tournament_format: string | null;
  tournament_config: { categories?: string[]; registration_mode?: string } | null;
  social_doubles_ladder_id: string | null;
};
type RegistrationStatus = 'confirmed' | 'waitlisted';
type Suspension = { starts_on: string; ends_on: string; reason: string };
type TournamentEntry = { category: string; payment_status: string; amount_cents: number };
export function EventCardActions({ eventId }: { eventId: string }) {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const operationKeys = useRef<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [approved, setApproved] = useState(false);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus | null>(null);
  const [registrationPaymentPending, setRegistrationPaymentPending] = useState(false);
  const [tournamentCategories, setTournamentCategories] = useState<string[]>([]);
  const [tournamentPaymentPending, setTournamentPaymentPending] = useState(false);
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
            'slug,status,starts_at,registration_opens_at,registration_closes_at,gender_restriction,price_cents,event_type,allow_plus_one,tournament_format,tournament_config,social_doubles_ladder_id',
          )
          .eq('id', eventId)
          .maybeSingle(),
      ]);
      if (!alive) return;
      setEvent(ev);
      if (user) {
        const [{ data: profile }, { data: reg }, { data: sus }, tournamentEntriesResult] =
          await Promise.all([
            db.from('profiles').select('application_status').eq('id', user.id).maybeSingle(),
            db
              .from('registrations')
              .select('id,status,created_at,payment_status,amount_cents')
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
              .gte(
                'ends_on',
                ev?.starts_at ? new Date(ev.starts_at).toLocaleDateString('en-CA') : '',
              )
              .limit(1),
            ev?.event_type === 'tournament'
              ? db.rpc('event_tournament_my_entries', { p_event_id: eventId })
              : Promise.resolve({ data: [], error: null }),
          ]);
        if (alive) {
          setSignedIn(true);
          setApproved(profile?.application_status === 'approved');
          if (reg) {
            setRegistrationId(reg.id);
            setRegistrationStatus(reg.status as RegistrationStatus);
            setRegistrationPaymentPending(
              ev?.event_type === 'party'
                ? reg.amount_cents > 0 &&
                    reg.status === 'confirmed' &&
                    reg.payment_status === 'pending'
                : ev?.price_cents > 0 &&
                    reg.status === 'confirmed' &&
                    reg.payment_status === 'pending',
            );
          }
          const tournamentEntries = (tournamentEntriesResult.data ?? []) as TournamentEntry[];
          setTournamentCategories([...new Set(tournamentEntries.map((entry) => entry.category))]);
          setTournamentPaymentPending(
            tournamentEntries.some(
              (entry) => entry.amount_cents > 0 && entry.payment_status === 'pending',
            ),
          );
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
  const hasTournamentRegistration = tournamentCategories.length > 0;
  const hasRegistration = !!registrationStatus || hasTournamentRegistration;
  const configuredCategoryCount =
    event?.tournament_format === 'team'
      ? 1
      : (event?.tournament_config?.categories ?? ['mixed', 'men', 'women']).length;
  const multiCategoryTournament = event?.event_type === 'tournament' && configuredCategoryCount > 1;
  const needsRegistrationSelection =
    event?.event_type === 'party' ||
    (event?.event_type === 'tournament' &&
      (event.social_doubles_ladder_id !== null ||
        configuredCategoryCount > 1 ||
        (event.tournament_format === 'doubles' &&
          (event.tournament_config?.registration_mode ?? 'both') === 'both')));
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
        setRegistrationPaymentPending(false);
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
  const statusLabel = hasTournamentRegistration
    ? tournamentPaymentPending
      ? multiCategoryTournament
        ? `Pending payment · registered for ${tournamentCategories.length} categories`
        : 'Pending payment'
      : multiCategoryTournament
        ? `Registered for ${tournamentCategories.length} ${tournamentCategories.length === 1 ? 'category' : 'categories'}`
        : 'Registered'
    : registrationStatus === 'confirmed'
      ? registrationPaymentPending
        ? 'Pending payment'
        : 'Registered'
      : registrationStatus === 'waitlisted'
        ? 'Waitlisted'
        : null;
  if (event.status !== 'published' && !hasRegistration) return null;
  if (!hasRegistration && !open) return null;
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
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusLabel === 'Waitlisted' ? 'bg-violet-600/10 text-violet-700 dark:text-violet-300' : statusLabel === 'Pending payment' ? 'bg-amber-600/10 text-amber-700 dark:text-amber-300' : 'bg-blue-600/10 text-blue-700 dark:text-blue-300'}`}
        >
          {statusLabel}
        </span>
      )}
      {hasTournamentRegistration ? (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            router.push(`/events/${event.slug || eventId}#registration`);
          }}
        >
          View registration
        </Button>
      ) : registrationId ? (
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
            if (needsRegistrationSelection) {
              router.push(`/events/${event.slug || eventId}#registration`);
            } else {
              void act(false);
            }
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
