'use client';
import { eventEditPath } from '@/lib/event-slug';
import { TennisLoader } from '@/components/tennis-loader';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { EventWeather } from '@/components/event-weather';

type Roster = {
  registration_id: string;
  user_id: string;
  status: string;
  queue_position: number | null;
  full_name: string;
  avatar_url: string | null;
  tennis_skill_level: number | null;
  email?: string | null;
  phone?: string | null;
};
type Court = { registration_id: string; court_number: number; segment_order: number };
type Score = {
  id: string;
  player_one_registration_id: string;
  player_two_registration_id: string;
  player_three_registration_id: string | null;
  player_four_registration_id: string | null;
  player_one_score: number;
  player_two_score: number;
  player_one_name: string;
  player_two_name: string;
  player_three_name: string | null;
  player_four_name: string | null;
  played_at: string;
  entered_by?: string | null;
};
type EventInfo = {
  id: string;
  slug?: string | null;
  title: string;
  description: string | null;
  gender_restriction?: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string | null;
  registration_opens_at: string;
  registration_closes_at: string | null;
  capacity: number;
  price_cents: number;
  members_only: boolean;
  status: string;
  location: string;
  notes: string;
  waitlist_enabled: boolean;
  court_count: number;
};
export function EventDetailClient({
  event,
  roster,
  courts,
  scores,
  currentUserId,
  currentRegistrationId,
  currentStatus,
  locationQuery,
  isManager,
  canViewParticipants,
  remainingSpots,
}: {
  event: EventInfo;
  roster: Roster[];
  courts: Court[];
  scores: Score[];
  currentUserId: string | null;
  currentRegistrationId: string | null;
  currentStatus: string | null;
  locationQuery: string;
  isManager: boolean;
  canViewParticipants: boolean;
  remainingSpots: number;
}) {
  const db = createSupabaseBrowserClient();
  const router = useRouter();
  const operationKeys = useRef<Record<string, string>>({});
  const [liveRoster, setLiveRoster] = useState<Roster[]>(roster);
  const [liveRegistrationId, setLiveRegistrationId] = useState<string | null>(
    currentRegistrationId,
  );
  const [liveStatus, setLiveStatus] = useState<string | null>(currentStatus);
  const [liveRemainingSpots, setLiveRemainingSpots] = useState<number>(remainingSpots);
  const [liveCourts, setLiveCourts] = useState<Court[]>(courts);
  const [view, setView] = useState<'courts' | 'list'>('list');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [scoreCourt, setScoreCourt] = useState('');
  const [partner, setPartner] = useState('');
  const [scoreOne, setScoreOne] = useState('');
  const [scoreTwo, setScoreTwo] = useState('');
  const [editingScore, setEditingScore] = useState<string | null>(null);
  const [editScoreOne, setEditScoreOne] = useState('');
  const [editScoreTwo, setEditScoreTwo] = useState('');
  const [sessionHasStarted, setSessionHasStarted] = useState(
    () => Date.now() >= new Date(event.starts_at).getTime(),
  );
  useEffect(() => {
    if (sessionHasStarted) return;
    const delay = Math.max(0, new Date(event.starts_at).getTime() - Date.now());
    const timer = window.setTimeout(() => setSessionHasStarted(true), delay + 25);
    return () => window.clearTimeout(timer);
  }, [event.starts_at, sessionHasStarted]);
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
  const [scoreCourtText, scoreSessionText] = scoreCourt.split(':');
  const scoreCourtNumber = Number(scoreCourtText);
  const scoreSessionNumber = Number(scoreSessionText);
  const courtPlayers = liveRoster
    .filter(
      (r) =>
        r.status === 'confirmed' &&
        liveCourts.some(
          (c) =>
            c.registration_id === r.registration_id &&
            c.court_number === scoreCourtNumber &&
            c.segment_order === scoreSessionNumber,
        ),
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const otherCourtPlayers = courtPlayers.filter((r) => r.registration_id !== liveRegistrationId);
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
    setLiveRemainingSpots(remainingSpots);
  }, [roster, currentRegistrationId, currentStatus, remainingSpots]);

  function notifyInBackground() {
    void (async () => {
      try {
        const response = await fetch('/api/notifications/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: event.id }),
        });
        const mail = await response.json().catch(() => ({}));
        if (!response.ok || mail.failed > 0)
          console.error('[Event detail] Email notification dispatch failed', {
            status: response.status,
            result: mail,
          });
      } catch (e) {
        console.error('[Event detail] Email notification request failed', e);
      }
    })();
  }
  async function refreshRoster() {
    const [{ data: nextRoster, error: rosterError }, { data: ownRegs, error: regError }] =
      await Promise.all([
        db
          .from('event_roster')
          .select(
            'registration_id,user_id,status,queue_position,full_name,avatar_url,tennis_skill_level',
          )
          .eq('event_id', event.id),
        currentUserId
          ? db
              .from('registrations')
              .select('id,status,queue_position,created_at')
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
              }[],
              error: null,
            }),
      ]);
    if (!rosterError && nextRoster) {
      setLiveRoster(nextRoster as Roster[]);
      setLiveRemainingSpots(
        Math.max(0, event.capacity - nextRoster.filter((r) => r.status === 'confirmed').length),
      );
    }
    if (!regError) {
      const ownReg = ownRegs?.[0] ?? null;
      setLiveRegistrationId(ownReg?.id ?? null);
      setLiveStatus(ownReg?.status ?? null);
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
  async function register() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const operation = `register:${event.id}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      const { data, error } = await db.rpc('register_for_event', {
        p_event_id: event.id,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      delete operationKeys.current[operation];
      const result = data?.[0];
      if (result?.registration_id) {
        setLiveRegistrationId(result.registration_id);
        setLiveStatus(result.registration_state);
      }
      await refreshRoster();
      const label =
        result?.registration_state === 'waitlisted'
          ? `Added to the waitlist at position ${result?.position_in_waitlist ?? '—'}.`
          : 'Registration confirmed.';
      setMessage(label);
      notifyInBackground();
      router.refresh();
    } catch (e) {
      console.error('[Event detail] Database registration failed', e);
      setError('Could not update registration. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (!liveRegistrationId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const operation = `withdraw:${liveRegistrationId}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      const { error } = await db.rpc('withdraw_from_event', {
        p_registration_id: liveRegistrationId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      delete operationKeys.current[operation];
      setLiveRegistrationId(null);
      setLiveStatus('cancelled');
      await refreshRoster();
      const label = 'Registration withdrawn. The waitlist has been updated.';
      setMessage(label);
      notifyInBackground();
      router.refresh();
    } catch (e) {
      console.error('[Event detail] Database withdrawal failed', e);
      setError('Could not update registration. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function saveEditedScore(scoreId: string) {
    if (!editingScore) return;
    if (Date.now() - new Date(event.starts_at).getTime() > 2 * 24 * 60 * 60 * 1000) {
      setError('Scores cannot be edited more than two days after the session.');
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
  async function addScore(e: FormEvent) {
    e.preventDefault();
    if (!liveRegistrationId || !scoreCourtNumber) return;
    if (Date.now() < new Date(event.starts_at).getTime()) {
      setError('Scores cannot be entered before the session start time.');
      return;
    }
    if (Date.now() - new Date(event.starts_at).getTime() > 2 * 24 * 60 * 60 * 1000) {
      setError('Scores can only be entered within two days of the event.');
      return;
    }
    if (courtPlayers.length !== 2 && courtPlayers.length !== 4) {
      setError(
        'Scores can be entered when exactly two or four players are assigned to the selected court in this sub-session.',
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
        player_one_registration_id: liveRegistrationId,
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
    const rating = liveRoster.find((r) => r.registration_id === registrationId)?.tennis_skill_level;
    return `${name}${rating != null ? ` (${rating})` : ''}`;
  }
  const scoreEditLocked =
    Date.now() - new Date(event.starts_at).getTime() > 2 * 24 * 60 * 60 * 1000;
  const money =
    event.price_cents === 0
      ? event.members_only
        ? 'Free for members'
        : 'Free'
      : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(
          event.price_cents / 100,
        );
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {money}
          {event.price_cents > 0 ? ' per person' : ''}
        </span>
        {Date.now() >= new Date(event.starts_at).getTime() &&
          Date.now() <= new Date(event.ends_at || event.starts_at).getTime() && (
            <span className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              In progress
            </span>
          )}
        {event.gender_restriction && (
          <span className="rounded-full bg-secondary px-3 py-1 text-xs">
            {event.gender_restriction === 'male'
              ? 'Male participants only'
              : 'Female participants only'}
          </span>
        )}
      </div>
      {event.description?.trim() && (
        <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
          {event.description.trim()}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Session</p>
          <p className="mt-2 font-medium">{new Date(event.starts_at).toLocaleString('en-CA')}</p>
          <p className="text-sm text-muted-foreground">
            Until{' '}
            {event.ends_at ? new Date(event.ends_at).toLocaleString('en-CA') : 'To be announced'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{event.location}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Registration</p>
          <p className="mt-2 text-sm">
            Opens {new Date(event.registration_opens_at).toLocaleString('en-CA')}
          </p>
          <p className="text-sm">
            Cutoff{' '}
            {event.registration_closes_at
              ? new Date(event.registration_closes_at).toLocaleString('en-CA')
              : 'Not set'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {event.members_only
              ? 'Active, paid membership required'
              : 'Open to all registered users'}
          </p>
        </div>
      </div>
      <EventWeather startsAt={event.starts_at} location={locationQuery || event.location} />
      <section className="rounded-xl border border-border p-5">
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
              <span className="text-sm font-semibold text-destructive">Event cancelled</span>
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
                  {liveStatus}
                  {liveStatus === 'waitlisted' && liveRegistrationId
                    ? ` · position ${waitlisted.find((r) => r.registration_id === liveRegistrationId)?.queue_position ?? '—'}`
                    : ''}
                </span>
                {canWithdraw && (
                  <Button
                    variant="outline"
                    className="border-red-500/70 text-red-700 hover:border-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                    disabled={busy}
                    onClick={() => setConfirmWithdraw(true)}
                  >
                    Withdraw
                  </Button>
                )}
              </>
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
            {isManager && (
              <Button asChild variant="outline">
                <Link href={eventEditPath(event)}>Edit event</Link>
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
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </section>
      {confirmWithdraw && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => {
            if (!busy) setConfirmWithdraw(false);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`withdraw-title-${event.id}`}
            aria-describedby={`withdraw-description-${event.id}`}
            className="w-full max-w-md rounded-xl border border-border bg-background p-6 text-left shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={`withdraw-title-${event.id}`} className="text-lg font-semibold">
              Withdraw from this event?
            </h2>
            <p
              id={`withdraw-description-${event.id}`}
              className="mt-2 text-sm text-muted-foreground"
            >
              If you withdraw, you will lose your current place. If you register again later, you
              may need to join the waitlist, and your previous place will not be restored.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmWithdraw(false)}
              >
                Keep my place
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-red-500/70 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                disabled={busy}
                onClick={() => {
                  setConfirmWithdraw(false);
                  void withdraw();
                }}
              >
                {busy ? <TennisLoader compact label="Withdrawing" /> : 'Confirm withdrawal'}
              </Button>
            </div>
          </section>
        </div>
      )}
      {canViewParticipants && (
        <>
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Players and courts</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Court assignments are shown for each sub-session.
                </p>
              </div>
              <div className="flex gap-1 rounded-lg border border-border p-1">
                <Button
                  size="sm"
                  variant={view === 'courts' ? 'secondary' : 'ghost'}
                  onClick={() => setView('courts')}
                >
                  Court view
                </Button>
                <Button
                  size="sm"
                  variant={view === 'list' ? 'secondary' : 'ghost'}
                  onClick={() => setView('list')}
                >
                  List view
                </Button>
              </div>
            </div>
            {view === 'courts' ? (
              <div className="mt-4 space-y-6">
                {!subsessions.length && (
                  <p className="text-sm text-muted-foreground">No court assignments yet.</p>
                )}
                {subsessions.map((session) => (
                  <section key={session}>
                    <h3 className="mb-3 text-lg font-semibold">Sub-session {session}</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(courtNumbers.length
                        ? courtNumbers
                        : Array.from({ length: event.court_count || 4 }, (_, i) => i + 1)
                      ).map((court) => {
                        const assigned = liveCourts.filter(
                          (c) => c.court_number === court && c.segment_order === session,
                        );
                        const peopleOnCourt = assigned
                          .map((a) =>
                            confirmed.find((p) => p.registration_id === a.registration_id),
                          )
                          .filter((p): p is Roster => !!p)
                          .sort((a, b) => a.full_name.localeCompare(b.full_name));
                        if (!peopleOnCourt.length) return null;
                        return (
                          <div key={court} className="rounded-xl border border-border p-4">
                            <div className="flex items-center justify-between">
                              <h4 className="font-semibold">Court {court}</h4>
                              <span className="text-xs text-muted-foreground">
                                {peopleOnCourt.length} players
                              </span>
                            </div>
                            <div className="mt-3 space-y-2">
                              {peopleOnCourt.map((p) => (
                                <div
                                  key={p.registration_id}
                                  className="rounded-md bg-muted/40 px-3 py-2 text-sm"
                                >
                                  <span className="mr-1 text-xs text-muted-foreground">
                                    {confirmed.findIndex(
                                      (x) => x.registration_id === p.registration_id,
                                    ) + 1}
                                    .
                                  </span>
                                  <span className="font-medium">{p.full_name || 'Member'}</span>
                                  {p.tennis_skill_level != null && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {p.tennis_skill_level}
                                    </span>
                                  )}
                                  {isManager && (p.email || p.phone) && (
                                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                                      {p.email && (
                                        <a href={`mailto:${p.email}`} className="hover:underline">
                                          {p.email}
                                        </a>
                                      )}
                                      {p.phone && (
                                        <a href={`tel:${p.phone}`} className="hover:underline">
                                          {p.phone}
                                        </a>
                                      )}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Player</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Court assignments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmed.map((p, index) => (
                      <tr key={p.registration_id} className="border-t border-border">
                        <td className="px-4 py-3">{index + 1}</td>
                        <td className="px-4 py-3">
                          <span>
                            {p.full_name || 'Member'}
                            {p.tennis_skill_level != null && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {p.tennis_skill_level}
                              </span>
                            )}
                          </span>
                          {isManager && (p.email || p.phone) && (
                            <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                              {p.email && (
                                <a href={`mailto:${p.email}`} className="hover:underline">
                                  {p.email}
                                </a>
                              )}
                              {p.phone && (
                                <a href={`tel:${p.phone}`} className="hover:underline">
                                  {p.phone}
                                </a>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 capitalize">Confirmed</td>
                        <td className="px-4 py-3">
                          {liveCourts
                            .filter((c) => c.registration_id === p.registration_id)
                            .sort((a, b) => a.segment_order - b.segment_order)
                            .map((c) => `Court ${c.court_number}`)
                            .join(' → ') || 'Not assigned'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-5 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Waitlist</h3>
              {waitlisted.length ? (
                <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
                  {waitlisted.map((p) => (
                    <li key={p.registration_id}>
                      {p.full_name || 'Member'}{' '}
                      <span className="text-muted-foreground">(position {p.queue_position})</span>
                      {isManager && (p.email || p.phone) && (
                        <span className="ml-2 inline-flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          {p.email && (
                            <a href={`mailto:${p.email}`} className="hover:underline">
                              {p.email}
                            </a>
                          )}
                          {p.phone && (
                            <a href={`tel:${p.phone}`} className="hover:underline">
                              {p.phone}
                            </a>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No one is on the waitlist.</p>
              )}
            </div>
          </section>
          <section>
            <h2 className="text-xl font-semibold">Scores</h2>
            {scores.length ? (
              <div className="mt-3 space-y-2">
                {scores.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <span>
                        {s.player_three_name
                          ? `${playerLabel(s.player_one_registration_id, s.player_one_name)} / ${playerLabel(s.player_two_registration_id, s.player_two_name)}`
                          : playerLabel(s.player_one_registration_id, s.player_one_name)}{' '}
                        <strong>
                          {s.player_one_score} – {s.player_two_score}
                        </strong>{' '}
                        {s.player_three_name
                          ? `${playerLabel(s.player_three_registration_id!, s.player_three_name)}${s.player_four_name ? ` / ${playerLabel(s.player_four_registration_id!, s.player_four_name)}` : ''}`
                          : playerLabel(s.player_two_registration_id, s.player_two_name)}
                      </span>
                      {editingScore === s.id && (
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <label className="text-xs">
                            Your team score
                            <input
                              type="number"
                              min="0"
                              value={editScoreOne}
                              onChange={(e) => setEditScoreOne(e.target.value)}
                              className="mt-1 block h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                            />
                          </label>
                          <label className="text-xs">
                            Opponents score
                            <input
                              type="number"
                              min="0"
                              value={editScoreTwo}
                              onChange={(e) => setEditScoreTwo(e.target.value)}
                              className="mt-1 block h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                            />
                          </label>
                          <Button
                            size="sm"
                            disabled={busy || editScoreOne === '' || editScoreTwo === ''}
                            onClick={() => void saveEditedScore(s.id)}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setEditingScore(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.played_at).toLocaleDateString('en-CA')}
                      </span>
                      {!scoreEditLocked &&
                        (isManager || Boolean(currentUserId && s.entered_by === currentUserId)) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingScore(s.id);
                              setEditScoreOne(String(s.player_one_score));
                              setEditScoreTwo(String(s.player_two_score));
                              setError('');
                            }}
                          >
                            Edit score
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No scores have been entered.</p>
            )}
            {currentUserId &&
              registered &&
              liveStatus === 'confirmed' &&
              event.status === 'published' &&
              !sessionHasStarted && (
                <p className="mt-5 rounded-xl border border-border p-4 text-sm text-muted-foreground">
                  Score entry will be available when the session starts at{' '}
                  {new Date(event.starts_at).toLocaleString('en-CA')}.
                </p>
              )}
            {currentUserId &&
              registered &&
              liveStatus === 'confirmed' &&
              event.status === 'published' &&
              sessionHasStarted &&
              !scoreEditLocked && (
                <form onSubmit={addScore} className="mt-5 rounded-xl border border-border p-4">
                  <h3 className="font-semibold">Add a score</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose a court and sub-session you are assigned to. On a four-player court,
                    select your partner; the other two players become your opponents automatically.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <label className="space-y-1 text-sm">
                      Court / sub-session
                      <select
                        required
                        value={scoreCourt}
                        onChange={(e) => {
                          setScoreCourt(e.target.value);
                          setPartner('');
                        }}
                        className="block h-10 w-full rounded-md border border-input bg-background px-3"
                      >
                        <option value="">Select assignment</option>
                        {currentCourts.map((c) => (
                          <option
                            key={`${c.court_number}-${c.segment_order}`}
                            value={`${c.court_number}:${c.segment_order}`}
                          >
                            Court {c.court_number} · Sub-session {c.segment_order}
                          </option>
                        ))}
                      </select>
                    </label>
                    {doublesCourt && (
                      <label className="space-y-1 text-sm">
                        Partner
                        <select
                          required
                          value={partner}
                          onChange={(e) => setPartner(e.target.value)}
                          className="block h-10 w-full rounded-md border border-input bg-background px-3"
                        >
                          <option value="">Select partner</option>
                          {partnerOptions.map((p) => (
                            <option key={p.registration_id} value={p.registration_id}>
                              {p.full_name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="space-y-1 text-sm">
                      Your team score
                      <input
                        required
                        type="number"
                        min="0"
                        value={scoreOne}
                        onChange={(e) => setScoreOne(e.target.value)}
                        className="block h-10 w-full rounded-md border border-input bg-background px-3"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      Opponents&apos; score
                      <input
                        required
                        type="number"
                        min="0"
                        value={scoreTwo}
                        onChange={(e) => setScoreTwo(e.target.value)}
                        className="block h-10 w-full rounded-md border border-input bg-background px-3"
                      />
                    </label>
                  </div>
                  {scoreCourt && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Opponents:{' '}
                      {doublesCourt && !partner
                        ? 'Select a partner to determine opponents.'
                        : opponents.map((p) => p.full_name).join(' / ') || 'No opponents assigned.'}
                    </p>
                  )}
                  <Button className="mt-3" disabled={busy || !currentCourts.length || !scoreCourt}>
                    {busy ? <TennisLoader compact label="Saving" /> : 'Save score'}
                  </Button>
                  {!currentCourts.length && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      You need a court assignment before entering a score.
                    </p>
                  )}
                </form>
              )}
          </section>
        </>
      )}
    </div>
  );
}
