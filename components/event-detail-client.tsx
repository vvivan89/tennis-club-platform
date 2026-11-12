'use client';
import { formatDateTime } from '@/lib/time-format';
import { formatCadPrice } from '@/lib/event-format';
import { useTimedFeedback } from '@/hooks/use-timed-feedback';
import { TennisLoader } from '@/components/tennis-loader';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { dispatchEventNotificationsInBackground } from '@/lib/event-notifications';
import { Button } from '@/components/ui/button';
import { EventWeather } from '@/components/event-weather';
import { InProgressBadge } from '@/components/in-progress-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EventWithdrawalDialog } from '@/components/event-withdrawal-dialog';
import { PaymentOptionsButton, type PaymentOption } from '@/components/payment-options-button';
import {
  InteracPaymentInstructionsDialog,
  type InteracPaymentNotice,
} from '@/components/interac-payment-instructions-dialog';
import {
  EventParticipantsPanel,
  EventScoresPanel,
  type EventCourtRow as Court,
  type EventRosterRow as Roster,
  type EventScoreRow as Score,
} from '@/components/event-detail-panels';
import { UserIdentity } from '@/components/user-identity';
import {
  EventActionFeedback,
  EventPaymentPendingNotices,
  PartyGuestFee,
  PartyRegistrationButtons,
} from '@/components/party-registration-controls';

import type { EventInfo } from '@/components/event-detail-types';
import { useEventRegistrationActions } from '@/components/use-event-registration-actions';
import { useSiteHeaderState } from '@/components/site-header-state';

export function EventDetailClient({
  event,
  roster,
  courts,
  scores,
  currentUserId,
  currentRegistrationId,
  currentGuestCount = 0,
  currentStatus,
  currentPaymentStatus,
  locationQuery,
  isManager,
  isAdmin = false,
  canViewParticipants,
  remainingSpots,
  interacEnabled = false,
}: {
  event: EventInfo;
  roster: Roster[];
  courts: Court[];
  scores: Score[];
  currentUserId: string | null;
  currentRegistrationId: string | null;
  currentGuestCount?: number;
  currentStatus: string | null;
  currentPaymentStatus: string | null;
  locationQuery: string;
  isManager: boolean;
  isAdmin?: boolean;
  canViewParticipants: boolean;
  remainingSpots: number;
  interacEnabled?: boolean;
}) {
  const { shortName } = useSiteHeaderState();
  const db = createSupabaseBrowserClient();
  const router = useRouter();
  useEffect(() => {
    document.title = [shortName, event.title].filter(Boolean).join(' | ');
  }, [event.title, shortName]);
  const eventNoun = event.event_type === 'tournament' ? 'Tournament' : 'Event';
  const operationKeys = useRef<Record<string, string>>({});
  const [liveRoster, setLiveRoster] = useState<Roster[]>(roster);
  const [liveRegistrationId, setLiveRegistrationId] = useState<string | null>(
    currentRegistrationId,
  );
  const [liveGuestCount, setLiveGuestCount] = useState(currentGuestCount);
  const [liveStatus, setLiveStatus] = useState<string | null>(currentStatus);
  const [livePaymentStatus, setLivePaymentStatus] = useState<string | null>(currentPaymentStatus);
  const [liveRemainingSpots, setLiveRemainingSpots] = useState<number>(remainingSpots);
  const [liveCourts, setLiveCourts] = useState<Court[]>(courts);
  const [view, setView] = useState<'courts' | 'list'>('list');
  const { busy, setBusy, error, setError, message, setMessage } = useTimedFeedback();
  const [interacNotice, setInteracNotice] = useState<InteracPaymentNotice | null>(null);
  const [pendingInteracNotice, setPendingInteracNotice] = useState<InteracPaymentNotice | null>(
    null,
  );
  const [pendingCardPayment, setPendingCardPayment] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [scoreCourt, setScoreCourt] = useState('');
  const [scorePlayerOne, setScorePlayerOne] = useState('');
  const [partner, setPartner] = useState('');
  const [scoreOne, setScoreOne] = useState('');
  const [scoreTwo, setScoreTwo] = useState('');
  const [editingScore, setEditingScore] = useState<string | null>(null);
  const [deletingScore, setDeletingScore] = useState<Score | null>(null);
  const [editScoreOne, setEditScoreOne] = useState('');
  const [editScoreTwo, setEditScoreTwo] = useState('');
  const [eventHasStarted, setEventHasStarted] = useState(
    () => Date.now() >= new Date(event.starts_at).getTime(),
  );
  useEffect(() => {
    setLivePaymentStatus(currentPaymentStatus);
  }, [currentPaymentStatus]);
  useEffect(() => {
    setLiveStatus(currentStatus);
  }, [currentStatus]);
  useEffect(() => {
    setLiveRegistrationId(currentRegistrationId);
    setLiveGuestCount(currentGuestCount);
  }, [currentRegistrationId, currentGuestCount]);
  useEffect(() => {
    let active = true;
    setPendingInteracNotice(null);
    setPendingCardPayment(false);
    if (!currentUserId || !liveRegistrationId) return;
    void Promise.all([
      interacEnabled
        ? db
            .from('payments')
            .select('id,amount_minor,status')
            .eq('user_id', currentUserId)
            .eq('purpose', 'event_registration')
            .eq('business_record_id', liveRegistrationId)
            .eq('provider', 'interac')
            .in('status', ['pending', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db
        .from('payments')
        .select('id')
        .eq('user_id', currentUserId)
        .eq('purpose', 'event_registration')
        .eq('business_record_id', liveRegistrationId)
        .eq('provider', 'stripe')
        .in('status', ['pending', 'processing'])
        .limit(1)
        .maybeSingle(),
      interacEnabled
        ? db
            .from('payment_method_settings')
            .select('interac_recipient_email,interac_instructions')
            .eq('id', 1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]).then(([interacPaymentResult, cardPaymentResult, settingsResult]) => {
      if (!active) return;
      setPendingCardPayment(!!cardPaymentResult.data);
      if (!interacPaymentResult.data) return;
      const payment = interacPaymentResult.data;
      const amount = (Number(payment.amount_minor || 0) / 100).toLocaleString('en-CA', {
        style: 'currency',
        currency: 'CAD',
      });
      setPendingInteracNotice({
        amount,
        recipientEmail: settingsResult.data?.interac_recipient_email || '',
        paymentId: payment.id,
        instructions: settingsResult.data?.interac_instructions || '',
        message: `Your Interac payment request for ${amount} is pending club confirmation.`,
      });
    });
    return () => {
      active = false;
    };
  }, [db, currentUserId, liveRegistrationId, livePaymentStatus, interacEnabled]);
  useEffect(() => {
    if (!currentUserId || !liveRegistrationId) return;
    const channel = db
      .channel(`event-payment-status-${event.id}-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'registrations',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const registration = payload.new as {
            id?: string;
            status?: string;
            payment_status?: string | null;
          };
          if (registration.id !== liveRegistrationId) return;
          if (registration.status) setLiveStatus(registration.status);
          if (registration.payment_status)
            setLivePaymentStatus(
              registration.payment_status === 'paid' ? 'paid' : registration.payment_status,
            );
        },
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [db, currentUserId, event.id, liveRegistrationId]);
  useEffect(() => {
    if (eventHasStarted) return;
    const delay = Math.max(0, new Date(event.starts_at).getTime() - Date.now());
    const timer = window.setTimeout(() => setEventHasStarted(true), delay + 25);
    return () => window.clearTimeout(timer);
  }, [event.starts_at, eventHasStarted]);
  const now = Date.now();
  const open =
    now >= new Date(event.registration_opens_at).getTime() &&
    (!event.registration_closes_at || now < new Date(event.registration_closes_at).getTime());
  const canWithdraw =
    !event.registration_closes_at || now < new Date(event.registration_closes_at).getTime();
  const registered = !!liveRegistrationId && liveStatus !== 'cancelled';
  const confirmed = liveRoster.filter((r) => r.status === 'confirmed');
  const waitlisted = liveRoster
    .filter((r) => r.status === 'waitlisted')
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0));
  const currentCourts = liveCourts.filter((c) => c.registration_id === liveRegistrationId);
  const scoreCourts = (isManager ? liveCourts : currentCourts).filter(
    (court, index, list) =>
      list.findIndex(
        (candidate) =>
          candidate.court_number === court.court_number &&
          candidate.segment_order === court.segment_order,
      ) === index,
  );
  const [scoreCourtText, scoreEventText] = scoreCourt.split(':');
  const scoreCourtNumber = Number(scoreCourtText);
  const scoreEventNumber = Number(scoreEventText);
  const courtPlayers = liveRoster
    .filter(
      (r) =>
        r.status === 'confirmed' &&
        liveCourts.some(
          (c) =>
            c.registration_id === r.registration_id &&
            c.court_number === scoreCourtNumber &&
            c.segment_order === scoreEventNumber,
        ),
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const playerOneId = isManager ? scorePlayerOne : liveRegistrationId;
  const otherCourtPlayers = courtPlayers.filter((r) => r.registration_id !== playerOneId);
  const doublesCourt = courtPlayers.length === 4;
  const partnerOptions = doublesCourt ? otherCourtPlayers : [];
  const opponents = useMemo(
    () => otherCourtPlayers.filter((r) => !doublesCourt || r.registration_id !== partner),
    [otherCourtPlayers, doublesCourt, partner],
  );
  const subsessions = Array.from(new Set(liveCourts.map((c) => c.segment_order))).sort(
    (a, b) => a - b,
  );
  const courtNumbers = Array.from(new Set(liveCourts.map((c) => c.court_number))).sort(
    (a, b) => a - b,
  );
  useEffect(() => {
    setLiveCourts(courts);
  }, [courts]);
  useEffect(() => {
    setLiveRoster(roster);
    setLiveRegistrationId(currentRegistrationId);
    setLiveStatus(currentStatus);
    setLivePaymentStatus(currentPaymentStatus);
    setLiveRemainingSpots(remainingSpots);
  }, [
    roster,
    currentRegistrationId,
    currentGuestCount,
    currentStatus,
    currentPaymentStatus,
    remainingSpots,
  ]);

  function notifyInBackground() {
    dispatchEventNotificationsInBackground(event.id, 'Event detail');
  }
  async function refreshRoster() {
    const [{ data: nextRoster, error: rosterError }, { data: ownRegs, error: regError }] =
      await Promise.all([
        db
          .from('event_roster')
          .select(
            'registration_id,user_id,status,payment_status,guest_count,queue_position,full_name,avatar_url,tennis_skill_level,birthday_emoji_visible',
          )
          .eq('event_id', event.id),
        currentUserId
          ? db
              .from('registrations')
              .select('id,status,queue_position,created_at,payment_status,guest_count')
              .eq('event_id', event.id)
              .eq('user_id', currentUserId)
              .neq('status', 'cancelled')
              .order('created_at', { ascending: false })
              .limit(1)
          : Promise.resolve({
              data: [] as {
                id: string;
                status: string;
                queue_position: number | null;
                created_at: string;
                payment_status: string;
                guest_count: number;
              }[],
              error: null,
            }),
      ]);
    if (!rosterError && nextRoster) {
      setLiveRoster(nextRoster as Roster[]);
      setLiveRemainingSpots(
        Math.max(
          0,
          event.capacity -
            nextRoster
              .filter((r) => r.status === 'confirmed')
              .reduce((total, row) => total + 1 + Number(row.guest_count ?? 0), 0),
        ),
      );
    }
    if (!regError) {
      const ownReg = ownRegs?.[0] ?? null;
      setLiveRegistrationId(ownReg?.id ?? null);
      setLiveStatus(ownReg?.status ?? null);
      setLivePaymentStatus(ownReg?.payment_status ?? null);
      setLiveGuestCount(Number(ownReg?.guest_count ?? 0));
    }
  }
  useEffect(() => {
    let active = true;
    const refreshAssignments = async () => {
      const { data, error } = await db
        .from('event_court_assignments')
        .select('registration_id,court_number,segment_order')
        .eq('event_id', event.id);
      if (active && !error) setLiveCourts(data ?? []);
    };
    const onLocalUpdate = () => {
      void refreshAssignments();
    };
    window.addEventListener('pctc-court-assignments-updated', onLocalUpdate);
    const channel = db
      .channel(`event-courts-${event.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_court_assignments',
          filter: `event_id=eq.${event.id}`,
        },
        () => {
          void refreshAssignments();
        },
      )
      .subscribe();
    return () => {
      active = false;
      window.removeEventListener('pctc-court-assignments-updated', onLocalUpdate);
      void db.removeChannel(channel);
    };
  }, [event.id]);
  const { startEventCheckout, checkEventPaymentStatus, register, withdraw } =
    useEventRegistrationActions({
      db,
      event,
      currentUserId,
      liveRegistrationId,
      liveGuestCount,
      livePaymentStatus,
      operationKeys,
      setLiveRegistrationId,
      setLiveGuestCount,
      setLiveStatus,
      setLivePaymentStatus,
      setBusy,
      setError,
      setMessage,
      setPendingInteracNotice,
      setInteracNotice,
      setPendingCardPayment,
      refreshRoster,
      notifyInBackground,
      refreshPage: () => router.refresh(),
    });
  async function saveEditedScore(scoreId: string) {
    if (!editingScore) return;
    if (Date.now() - new Date(event.starts_at).getTime() > 2 * 24 * 60 * 60 * 1000) {
      setError('Scores cannot be edited more than two days after the event.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error } = await db
        .from('event_scores')
        .update({ player_one_score: Number(editScoreOne), player_two_score: Number(editScoreTwo) })
        .eq('id', scoreId)
        .eq('event_id', event.id);
      if (error) throw error;
      setEditingScore(null);
      setMessage('Score updated.');
      router.refresh();
    } catch (e) {
      console.error('[Event detail] Score update failed', e);
      setError('Could not save changes. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function deleteScore() {
    if (!deletingScore) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error } = await db
        .from('event_scores')
        .delete()
        .eq('id', deletingScore.id)
        .eq('event_id', event.id);
      if (error) throw error;
      setDeletingScore(null);
      setMessage('Score deleted.');
      router.refresh();
    } catch (e) {
      console.error('[Event detail] Score deletion failed', e);
      setDeletingScore(null);
      setError('Could not delete score. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function addScore(e: FormEvent) {
    e.preventDefault();
    const scoringPlayerOne = isManager ? scorePlayerOne : liveRegistrationId;
    if (!scoringPlayerOne || !scoreCourtNumber) return;
    if (!courtPlayers.some((player) => player.registration_id === scoringPlayerOne)) {
      setError('Choose a player assigned to the selected court and time slot.');
      return;
    }
    if (Date.now() < new Date(event.starts_at).getTime()) {
      setError('Scores cannot be entered before the event start time.');
      return;
    }
    if (Date.now() - new Date(event.starts_at).getTime() > 2 * 24 * 60 * 60 * 1000) {
      setError('Scores can only be entered within two days of the event.');
      return;
    }
    if (courtPlayers.length !== 2 && courtPlayers.length !== 4) {
      setError(
        'Scores can be entered when exactly two or four players are assigned to the selected court in this time slot.',
      );
      return;
    }
    const selectedPartner = doublesCourt ? partner : '';
    const opponentPlayers = otherCourtPlayers.filter(
      (r) => !doublesCourt || r.registration_id !== selectedPartner,
    );
    if (doublesCourt && !selectedPartner) {
      setError('Select your partner.');
      return;
    }
    if (!opponentPlayers.length) {
      setError('There are no opponents assigned to this court.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error } = await db.from('event_scores').insert({
        event_id: event.id,
        player_one_registration_id: scoringPlayerOne,
        player_two_registration_id: selectedPartner || opponentPlayers[0].registration_id,
        player_three_registration_id: selectedPartner ? opponentPlayers[0].registration_id : null,
        player_four_registration_id: selectedPartner
          ? (opponentPlayers[1]?.registration_id ?? null)
          : null,
        player_one_score: Number(scoreOne),
        player_two_score: Number(scoreTwo),
        entered_by: currentUserId,
      });
      if (error) throw error;
      setScoreOne('');
      setScoreTwo('');
      setPartner('');
      setMessage('Score saved.');
      router.refresh();
    } catch (e) {
      console.error('[Event detail] Score creation failed', e);
      setError('Could not save score. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  function playerLabel(registrationId: string, name: string) {
    const player = liveRoster.find((r) => r.registration_id === registrationId);
    return (
      <UserIdentity
        name={player?.full_name ?? name}
        skillLevel={player?.tennis_skill_level}
        avatarUrl={player?.avatar_url}
        birthdayVisible={player?.birthday_emoji_visible}
        compact
      />
    );
  }
  const scoreEditLocked =
    Date.now() - new Date(event.starts_at).getTime() > 2 * 24 * 60 * 60 * 1000;
  const registrationAmount =
    event.price_cents +
    (event.event_type === 'party' ? (event.guest_price_cents ?? 0) * liveGuestCount : 0);
  const money =
    registrationAmount === 0
      ? event.members_only
        ? 'Free for members'
        : 'Free'
      : formatCadPrice(registrationAmount);
  const memberPrice = event.price_cents === 0 ? 'Free' : formatCadPrice(event.price_cents);
  const eventPaymentOptions: PaymentOption[] = [];
  if (liveRegistrationId) {
    const checkingCardPayment =
      pendingCardPayment &&
      ['pending', 'processing'].includes(livePaymentStatus || '') &&
      !pendingInteracNotice;
    eventPaymentOptions.push({
      label: checkingCardPayment ? 'Check card payment status' : `By card · ${money}`,
      onSelect: () =>
        checkingCardPayment
          ? void checkEventPaymentStatus(liveRegistrationId)
          : void startEventCheckout(liveRegistrationId),
      loading: busy,
      loadingLabel: checkingCardPayment ? 'Checking payment' : 'Starting checkout',
    });
    if (interacEnabled) {
      eventPaymentOptions.push({
        label: pendingInteracNotice
          ? `View Interac instructions · ${pendingInteracNotice.amount}`
          : `By Interac · ${money}`,
        onSelect: () =>
          pendingInteracNotice
            ? setInteracNotice(pendingInteracNotice)
            : void startEventCheckout(liveRegistrationId, 'interac'),
        loading: busy,
        loadingLabel: 'Starting Interac request',
      });
    }
  }
  return (
    <div className="space-y-8">
      <EventActionFeedback error={error} message={message} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {event.event_type === 'party' ? memberPrice : money}
          {event.event_type === 'party'
            ? ' per member'
            : event.price_cents > 0
              ? ' per person'
              : ''}
        </span>
        {Date.now() >= new Date(event.starts_at).getTime() &&
          Date.now() <= new Date(event.ends_at || event.starts_at).getTime() && <InProgressBadge />}
        {event.gender_restriction && (
          <span className="rounded-full bg-secondary px-3 py-1 text-xs">
            {event.gender_restriction === 'male'
              ? 'Male participants only'
              : 'Female participants only'}
          </span>
        )}
        {event.event_type === 'party' && event.allow_plus_one && (
          <PartyGuestFee priceCents={event.guest_price_cents ?? 0} />
        )}
      </div>
      {event.description?.trim() && (
        <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
          {event.description.trim()}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{eventNoun}</p>
          <p className="mt-2 font-medium">{formatDateTime(event.starts_at)}</p>
          <p className="text-sm text-muted-foreground">
            Until {event.ends_at ? formatDateTime(event.ends_at) : 'To be announced'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{event.location}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Registration</p>
          <p className="mt-2 text-sm">Opens {formatDateTime(event.registration_opens_at)}</p>
          <p className="text-sm">
            Cutoff{' '}
            {event.registration_closes_at
              ? formatDateTime(event.registration_closes_at)
              : 'Not set'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {event.event_type === 'party'
              ? 'Approved club membership required'
              : event.members_only
                ? 'Active, paid membership required'
                : 'Open to all registered users'}
          </p>
        </div>
      </div>
      <EventWeather
        startsAt={event.starts_at}
        endsAt={event.ends_at || undefined}
        location={locationQuery || event.location}
        eventLabel={event.event_type === 'tournament' ? 'tournament' : 'event'}
      />
      <section id="registration" className="scroll-mt-24 rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Registration</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {liveRemainingSpots === 0
                ? 'No spots remaining'
                : `${liveRemainingSpots} ${liveRemainingSpots === 1 ? 'spot' : 'spots'} remaining`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {event.status === 'cancelled' ? (
              <span className="text-sm font-semibold text-destructive">{eventNoun} cancelled</span>
            ) : !currentUserId ? (
              <Button asChild>
                <Link
                  href={`/login?next=${encodeURIComponent(`/events/${event.slug || event.id}`)}`}
                >
                  Sign in to register
                </Link>
              </Button>
            ) : registered ? (
              <>
                <span className="self-center text-sm font-medium capitalize">
                  {liveStatus === 'confirmed' &&
                  registrationAmount > 0 &&
                  livePaymentStatus !== 'paid' &&
                  livePaymentStatus !== 'not_required'
                    ? 'Pending'
                    : liveStatus}
                  {liveStatus === 'waitlisted' && liveRegistrationId
                    ? ` · position ${waitlisted.find((r) => r.registration_id === liveRegistrationId)?.queue_position ?? '—'}`
                    : ''}
                </span>
                {registrationAmount > 0 &&
                  liveStatus === 'confirmed' &&
                  livePaymentStatus !== 'paid' &&
                  livePaymentStatus !== 'not_required' && (
                    <PaymentOptionsButton options={eventPaymentOptions} disabled={busy} />
                  )}
                <EventPaymentPendingNotices
                  interacAmount={
                    pendingInteracNotice && liveStatus === 'confirmed'
                      ? pendingInteracNotice.amount
                      : null
                  }
                  paymentPending={
                    registrationAmount > 0 &&
                    liveStatus === 'confirmed' &&
                    livePaymentStatus !== 'paid' &&
                    livePaymentStatus !== 'not_required'
                  }
                />
                {canWithdraw && (
                  <Button
                    variant="outline"
                    className="border-destructive/70 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive dark:text-destructive dark:hover:bg-destructive/40"
                    disabled={busy}
                    onClick={() => setConfirmWithdraw(true)}
                  >
                    Withdraw
                  </Button>
                )}
              </>
            ) : event.event_type === 'party' && event.allow_plus_one && open ? (
              <PartyRegistrationButtons
                busy={busy}
                onRegister={(withGuest) => void register(withGuest)}
              />
            ) : (
              <Button
                disabled={busy || !open || event.status !== 'published'}
                onClick={() => void register()}
              >
                {busy ? (
                  <TennisLoader compact label="Working" />
                ) : open ? (
                  'Register'
                ) : (
                  'Registration closed'
                )}
              </Button>
            )}
          </div>
        </div>
        {event.status === 'cancelled' && (
          <p className="mt-3 text-sm font-medium text-destructive">
            This event has been cancelled. Registration and attendance changes are unavailable.
          </p>
        )}
        {!open && event.status === 'published' && (
          <p className="mt-3 text-sm text-muted-foreground">
            Registration is not currently open. Check the opening and cutoff times above.
          </p>
        )}
      </section>
      <EventWithdrawalDialog
        eventId={event.id}
        open={confirmWithdraw}
        busy={busy}
        onCancel={() => setConfirmWithdraw(false)}
        onConfirm={() => {
          setConfirmWithdraw(false);
          void withdraw();
        }}
      />
      {canViewParticipants && (
        <>
          <EventParticipantsPanel
            party={event.event_type === 'party'}
            eventCourtCount={event.court_count}
            eventPriceCents={event.price_cents}
            view={view}
            setView={setView}
            subsessions={subsessions}
            courtNumbers={courtNumbers}
            liveCourts={liveCourts}
            confirmed={confirmed}
            isManager={isManager}
            waitlisted={waitlisted}
          />
          <EventScoresPanel
            scores={scores}
            playerLabel={playerLabel}
            editingScore={editingScore}
            setEditingScore={setEditingScore}
            editScoreOne={editScoreOne}
            setEditScoreOne={setEditScoreOne}
            editScoreTwo={editScoreTwo}
            setEditScoreTwo={setEditScoreTwo}
            saveEditedScore={saveEditedScore}
            busy={busy}
            scoreEditLocked={scoreEditLocked}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            setDeletingScore={setDeletingScore}
            clearError={() => setError('')}
            currentUserCanAddScore={
              !!currentUserId && (isManager || (registered && liveStatus === 'confirmed'))
            }
            event={event}
            eventHasStarted={eventHasStarted}
            formatDateTime={formatDateTime}
            addScore={addScore}
            isManager={isManager}
            scoreCourt={scoreCourt}
            setScoreCourt={setScoreCourt}
            setScorePlayerOne={setScorePlayerOne}
            setPartner={setPartner}
            scoreCourts={scoreCourts}
            courtPlayers={courtPlayers}
            scorePlayerOne={scorePlayerOne}
            partner={partner}
            partnerOptions={partnerOptions}
            doublesCourt={doublesCourt}
            scoreOne={scoreOne}
            setScoreOne={setScoreOne}
            scoreTwo={scoreTwo}
            setScoreTwo={setScoreTwo}
            opponents={opponents}
          />
        </>
      )}
      <ConfirmDialog
        open={!!deletingScore}
        title="Delete score?"
        description="This score will be permanently removed."
        confirmLabel="Delete score"
        destructive
        busy={busy}
        onConfirm={() => void deleteScore()}
        onCancel={() => setDeletingScore(null)}
      />
      <InteracPaymentInstructionsDialog
        notice={interacNotice}
        onClose={() => setInteracNotice(null)}
      />
    </div>
  );
}
