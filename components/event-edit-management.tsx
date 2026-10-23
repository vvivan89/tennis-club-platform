'use client';
import Image from 'next/image';
import { TennisLoader } from '@/components/tennis-loader';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { SearchableMemberSelect } from '@/components/searchable-member-select';
import { ConfirmDialog } from '@/components/confirm-dialog';

type Person = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  email?: string | null;
  phone?: string | null;
  tennis_skill_level?: number | null;
  suspended?: boolean;
};
type Participant = {
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
type Assignment = { registration_id: string; court_number: number; segment_order: number };
type RecordLine = { wins: number; losses: number };
type Warning = { kind: 'overfull' | 'count'; message: string };
type Session = Record<number, string[]>;
type Confirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};
function validateAssignments(participants: Participant[], assignments: Assignment[]): Warning[] {
  const confirmed = participants.filter((p) => p.status === 'confirmed');
  const confirmedIds = new Set(confirmed.map((p) => p.registration_id));
  const valid = [
    ...new Map(
      assignments
        .filter((a) => confirmedIds.has(a.registration_id))
        .map((a) => [`${a.registration_id}:${a.segment_order}:${a.court_number}`, a]),
    ).values(),
  ];
  const counts = confirmed.map((p) => ({
    name: p.full_name || 'Member',
    count: new Set(
      valid.filter((a) => a.registration_id === p.registration_id).map((a) => a.segment_order),
    ).size,
  }));
  const warnings: Warning[] = [];
  if (counts.some((x) => x.count > 0) && new Set(counts.map((x) => x.count)).size > 1)
    warnings.push({
      kind: 'count',
      message: 'The number of assigned sub-sessions differs between participants.',
    });
  const bySession = new Map<string, Set<string>>();
  for (const a of valid) {
    const key = `${a.segment_order}:${a.court_number}`;
    if (!bySession.has(key)) bySession.set(key, new Set());
    bySession.get(key)!.add(a.registration_id);
  }
  for (const [key, ids] of bySession)
    if (ids.size > 4)
      warnings.push({
        kind: 'overfull',
        message: `Sub-session ${key.split(':')[0]}, Court ${key.split(':')[1]} has ${ids.size} players (maximum 4).`,
      });
  return warnings;
}
export function EventEditManagement({
  eventId,
  startsAt,
  assignmentOnly = false,
}: {
  eventId: string;
  startsAt?: string;
  assignmentOnly?: boolean;
}) {
  const db = createSupabaseBrowserClient();
  const router = useRouter();
  const operationKeys = useRef<Record<string, string>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [usedUserIds, setUsedUserIds] = useState<Set<string>>(new Set());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<string>('');
  const [replaceUser, setReplaceUser] = useState('');
  const [records, setRecords] = useState<Record<string, RecordLine>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  function requestConfirmation(next: Confirmation) {
    setConfirmation(next);
  }
  async function load() {
    const [directory, registrations, courts, scores, allRegistrations] = await Promise.all([
      db.rpc('event_member_directory', { p_event_id: eventId }),
      db
        .from('registrations')
        .select('id,user_id,status,queue_position,created_at')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'waitlisted'])
        .order('created_at', { ascending: true }),
      db
        .from('event_court_assignments')
        .select('registration_id,court_number,segment_order')
        .eq('event_id', eventId),
      db
        .from('event_scores')
        .select(
          'player_one_registration_id,player_two_registration_id,player_three_registration_id,player_four_registration_id,player_one_score,player_two_score',
        )
        .gte('played_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      db.from('registrations').select('user_id,status').eq('event_id', eventId),
    ]);
    if (directory.error) {
      console.error('[Event management] Member directory load failed', directory.error);
      setError('Could not load event management data. Please try again.');
    } else setPeople(directory.data ?? []);
    if (!allRegistrations.error)
      setUsedUserIds(
        new Set(
          (allRegistrations.data ?? [])
            .filter((r) => r.status !== 'cancelled')
            .map((r) => r.user_id),
        ),
      );
    else {
      console.error('[Event management] Registration lookup failed', allRegistrations.error);
      setError('Could not load event management data. Please try again.');
    }
    if (registrations.error) {
      console.error('[Event management] Registrations load failed', registrations.error);
      setError('Could not load event management data. Please try again.');
    } else {
      const directoryPeople = (directory.data ?? []) as Person[];
      const contactById = new Map<string, Person>(directoryPeople.map((p) => [p.id, p] as const));
      setParticipants(
        (registrations.data ?? []).map((p) => {
          const contact = contactById.get(p.user_id);

          return {
            ...contact,
            id: p.user_id,
            user_id: p.user_id,
            registration_id: p.id,
            status: p.status,
            queue_position: p.queue_position,
            full_name: contact?.full_name ?? 'Unknown member',
            avatar_url: contact?.avatar_url ?? null,
            tennis_skill_level: contact?.tennis_skill_level ?? null,
          };
        }),
      );
    }
    if (courts.error) {
      console.error('[Event management] Court assignments load failed', courts.error);
      setError('Could not load event management data. Please try again.');
    } else setAssignments(courts.data ?? []);
    if (!scores.error && scores.data) {
      const regIds = [
        ...new Set(
          scores.data.flatMap(
            (x) =>
              [
                x.player_one_registration_id,
                x.player_two_registration_id,
                x.player_three_registration_id,
                x.player_four_registration_id,
              ].filter(Boolean) as string[],
          ),
        ),
      ];
      const { data: regs } = regIds.length
        ? await db.from('registrations').select('id,user_id').in('id', regIds)
        : { data: [] as { id: string; user_id: string }[] };
      const regToUser = new Map((regs ?? []).map((r) => [r.id, r.user_id]));
      const next: Record<string, RecordLine> = {};
      for (const score of scores.data) {
        const won = Number(score.player_one_score) > Number(score.player_two_score),
          lost = Number(score.player_one_score) < Number(score.player_two_score);
        const doubles = Boolean(score.player_three_registration_id);
        const one = doubles
          ? ([score.player_one_registration_id, score.player_two_registration_id].filter(
              Boolean,
            ) as string[])
          : [score.player_one_registration_id];
        const two = doubles
          ? ([score.player_three_registration_id, score.player_four_registration_id].filter(
              Boolean,
            ) as string[])
          : [score.player_two_registration_id];
        for (const id of one) {
          const uid = regToUser.get(id);
          if (uid) {
            next[uid] ??= { wins: 0, losses: 0 };
            if (won) next[uid].wins++;
            if (lost) next[uid].losses++;
          }
        }
        for (const id of two) {
          const uid = regToUser.get(id);
          if (uid) {
            next[uid] ??= { wins: 0, losses: 0 };
            if (lost) next[uid].wins++;
            if (won) next[uid].losses++;
          }
        }
      }
      setRecords(next);
    }
  }
  function notifyInBackground() {
    void (async () => {
      try {
        const response = await fetch('/api/notifications/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.failed > 0)
          console.error('[Event management] Email notification dispatch failed', {
            status: response.status,
            result,
          });
      } catch (e) {
        console.error('[Event management] Email notification request failed', e);
      }
    })();
  }
  useEffect(() => {
    void load();
  }, [eventId]);
  async function participantAction(userId: string, action: 'add' | 'remove', confirmed = false) {
    const selectedForAction = action === 'add' ? people.find((p) => p.id === userId) : undefined;
    if (!confirmed && action === 'add' && selectedForAction?.suspended) {
      requestConfirmation({
        title: 'Add suspended member?',
        description: 'This member is suspended for the event date. Add them to this event anyway?',
        confirmLabel: 'Add member',
        onConfirm: () => void participantAction(userId, action, true),
      });
      return;
    }
    if (action === 'remove' && !confirmed) {
      const reg = participants.find((p) => p.user_id === userId);
      let hasScores = false;
      if (reg) {
        const { data } = await db
          .from('event_scores')
          .select('id')
          .eq('event_id', eventId)
          .or(
            `player_one_registration_id.eq.${reg.registration_id},player_two_registration_id.eq.${reg.registration_id},player_three_registration_id.eq.${reg.registration_id},player_four_registration_id.eq.${reg.registration_id}`,
          )
          .limit(1);
        hasScores = Boolean(data?.length);
      }
      const hasAssignments = assignments.some((a) => a.registration_id === reg?.registration_id);
      const prompt =
        hasAssignments || hasScores
          ? 'This participant has court assignments or recorded scores. Removing them will also remove their assignments and may affect score history. Continue?'
          : 'Remove this participant from the event?';
      requestConfirmation({
        title: 'Remove participant?',
        description: prompt,
        confirmLabel: 'Remove participant',
        destructive: true,
        onConfirm: () => void participantAction(userId, action, true),
      });
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const selectedPerson = action === 'add' ? people.find((p) => p.id === userId) : undefined;
      const existingParticipant = participants.find((p) => p.user_id === userId);
      const operation = `registration:${eventId}:${action}:${userId}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      const { data: actionResult, error } = await db.rpc('manage_event_registration', {
        p_event_id: eventId,
        p_user_id: userId,
        p_action: action,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      delete operationKeys.current[operation];
      const outcome = Array.isArray(actionResult) ? actionResult[0] : actionResult;
      if (action === 'remove') {
        setParticipants((old) => old.filter((p) => p.user_id !== userId));
        if (existingParticipant)
          setAssignments((old) =>
            old.filter((a) => a.registration_id !== existingParticipant.registration_id),
          );
        setUsedUserIds((old) => {
          const next = new Set(old);
          next.delete(userId);
          return next;
        });
      } else if (selectedPerson && outcome?.registration_id) {
        setParticipants((old) => [
          ...old.filter((p) => p.user_id !== userId),
          {
            registration_id: outcome.registration_id,
            user_id: userId,
            status: outcome.registration_state ?? 'confirmed',
            queue_position: outcome.position_in_waitlist ?? null,
            full_name: selectedPerson.full_name,
            avatar_url: selectedPerson.avatar_url,
            tennis_skill_level: selectedPerson.tennis_skill_level ?? null,
            email: selectedPerson.email,
            phone: selectedPerson.phone,
          },
        ]);
        setUsedUserIds((old) => new Set([...old, userId]));
      }
      setSelected(null);
      setMessage(
        action === 'add'
          ? 'Member added or waitlisted.'
          : 'Member removed; the waitlist was updated.',
      );
      void load();
      router.refresh();
      notifyInBackground();
    } catch (e) {
      console.error('[Event management] Participant update failed', e);
      setError('Could not update participant. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  function openCourtModal() {
    const max = Math.max(1, ...assignments.map((a) => a.segment_order));
    const built: Session[] = [];
    for (let i = 1; i <= max; i++) {
      const session: Session = { 1: [], 2: [], 3: [], 4: [] };
      for (const a of assignments.filter((x) => x.segment_order === i))
        session[a.court_number].push(a.registration_id);
      built.push(session);
    }
    if (!assignments.length) {
      const empty: Session = { 1: [], 2: [], 3: [], 4: [] };
      built.push(empty);
    }
    setSessions(built);
    setModalOpen(true);
  }
  function addSession() {
    const first = sessions[0] ?? { 1: [], 2: [], 3: [], 4: [] };
    setSessions((old) => [
      ...old,
      { 1: [...first[1]], 2: [...first[2]], 3: [...first[3]], 4: [...first[4]] },
    ]);
  }
  function movePlayer(registrationId: string, court: number, sessionIndex: number) {
    setSessions((old) =>
      old.map((s, i) => {
        if (i !== sessionIndex) return s;
        const next: Session = { 1: [...s[1]], 2: [...s[2]], 3: [...s[3]], 4: [...s[4]] };
        for (const c of [1, 2, 3, 4]) next[c] = next[c].filter((id) => id !== registrationId);
        next[court].push(registrationId);
        return next;
      }),
    );
    setDragging(null);
  }
  async function saveAllCourts(skipWarnings = false) {
    if (startsAt && Date.now() - new Date(startsAt).getTime() > 2 * 24 * 60 * 60 * 1000) {
      setError('Court assignments cannot be changed more than two days after the session.');
      return;
    }
    const confirmed = participants.filter((p) => p.status === 'confirmed');
    const missing = sessions.flatMap((s, i) =>
      confirmed
        .filter((p) => ![1, 2, 3, 4].some((c) => s[c].includes(p.registration_id)))
        .map((p) => `Sub-session ${i + 1}: ${p.full_name || 'Member'}`),
    );
    if (missing.length) {
      setError(
        `Every confirmed participant must be assigned in every sub-session. Unassigned: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`,
      );
      return;
    }
    const rows: Assignment[] = [];
    sessions.forEach((s, i) =>
      [1, 2, 3, 4].forEach((c) =>
        s[c].forEach((id) =>
          rows.push({ registration_id: id, court_number: c, segment_order: i + 1 }),
        ),
      ),
    );
    const warnings = validateAssignments(participants, rows);
    if (warnings.length && !skipWarnings) {
      requestConfirmation({
        title: 'Court assignment warnings',
        description: `${warnings.map((w) => w.message).join('\n')}\n\nSave these assignments anyway?`,
        confirmLabel: 'Save anyway',
        onConfirm: () => void saveAllCourts(true),
      });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const operation = `courts:${eventId}:${JSON.stringify(rows)}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      const { error } = await db.rpc('save_event_court_assignments', {
        p_event_id: eventId,
        p_assignments: rows,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      delete operationKeys.current[operation];
      await load();
      window.dispatchEvent(new Event('pctc-court-assignments-updated'));
      router.refresh();
      setModalOpen(false);
      setMessage('Court assignments saved.');
    } catch (e) {
      console.error('[Event management] Court assignment save failed', e);
      setError('Could not save court assignments. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function replaceParticipant(oldUserId: string, confirmed = false) {
    if (!replaceUser) return;
    const target = people.find((p) => p.id === replaceUser);
    const targetParticipant = participants.find(
      (p) => p.user_id === replaceUser && p.status === 'waitlisted',
    );
    if (!confirmed) {
      const notes = [
        'Replace this player? Court assignments and score references will be transferred where applicable.',
      ];
      if (targetParticipant && targetParticipant.queue_position !== 1)
        notes.push(
          `The selected player is waitlisted at position ${targetParticipant.queue_position ?? 'unknown'}. They will be promoted to confirmed immediately, ahead of other waitlisted players.`,
        );
      if (target?.suspended)
        notes.push(
          'The selected player is suspended for the event date. Continue only if you intend to override that suspension for this event.',
        );
      requestConfirmation({
        title: 'Confirm player replacement',
        description: notes.join('\n\n'),
        confirmLabel: 'Replace player',
        onConfirm: () => void replaceParticipant(oldUserId, true),
      });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const operation = `replace:${eventId}:${oldUserId}:${replaceUser}`;
      const idempotencyKey = (operationKeys.current[operation] ??= crypto.randomUUID());
      const { error } = await db.rpc('replace_event_participant', {
        p_event_id: eventId,
        p_old_user_id: oldUserId,
        p_new_user_id: replaceUser,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      delete operationKeys.current[operation];
      await load();
      setReplaceFor('');
      setReplaceUser('');
      setMessage('Player replaced.');
      router.refresh();
    } catch (e) {
      console.error('[Event management] Participant replacement failed', e);
      setError('Could not replace player. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  const courtChangesLocked = Boolean(
    startsAt && Date.now() - new Date(startsAt).getTime() > 2 * 24 * 60 * 60 * 1000,
  );
  const activeIds = new Set(participants.map((p) => p.user_id));
  const addOptions = useMemo(
    () =>
      people
        .map((p) => ({
          ...p,
          available: !activeIds.has(p.id) && !usedUserIds.has(p.id),
          unavailableReason: 'Already registered for this event',
          statusText: p.suspended ? 'Suspended for this event date' : undefined,
        }))
        .sort(
          (a, b) =>
            Number(a.available === false) - Number(b.available === false) ||
            (a.full_name || '').localeCompare(b.full_name || ''),
        ),
    [people, participants, usedUserIds],
  );
  const replaceOptions = useMemo(
    () =>
      people
        .map((p) => {
          const existing = participants.find((x) => x.user_id === p.id);
          const waitlisted = existing?.status === 'waitlisted';
          const confirmed = existing?.status === 'confirmed';
          return {
            ...p,
            available: !confirmed && (!usedUserIds.has(p.id) || waitlisted),
            unavailableReason: undefined,
            statusText:
              [
                waitlisted
                  ? `Waitlisted · position ${existing?.queue_position ?? '—'}`
                  : confirmed
                    ? 'Already confirmed'
                    : null,
                p.suspended ? 'Suspended for this event date' : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined,
            _sort: waitlisted ? 0 : confirmed ? 2 : 1,
          };
        })
        .sort((a, b) => a._sort - b._sort || (a.full_name || '').localeCompare(b.full_name || ''))
        .map(({ _sort, ...visible }) => visible),
    [people, participants, usedUserIds],
  );
  const warnings = useMemo(
    () => validateAssignments(participants, assignments),
    [participants, assignments],
  );
  return (
    <section className="mt-8 space-y-6">
      {!assignmentOnly && (
        <div className="rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold">Add or remove participants</h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 flex-1">
              <SearchableMemberSelect
                options={addOptions}
                value={selected?.id || ''}
                onChange={(id) => setSelected(people.find((p) => p.id === id) || null)}
                placeholder="Select a member…"
              />
            </div>
            <Button
              disabled={busy || !selected}
              onClick={() => selected && void participantAction(selected.id, 'add')}
            >
              Add member
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Members are confirmed while capacity remains; additional members are placed on the
            waitlist.
          </p>
        </div>
      )}
      {!assignmentOnly && warnings.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
        >
          <p className="font-semibold">Court assignment warnings</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {warnings.map((w, i) => (
              <li key={`${w.kind}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!courtChangesLocked && (
        <div className="flex justify-end">
          <Button onClick={openCourtModal}>Assign courts</Button>
        </div>
      )}
      {courtChangesLocked && (
        <p className="text-xs text-muted-foreground">
          Court assignments are locked because this session ended more than two days ago.
        </p>
      )}
      {!assignmentOnly &&
        (['confirmed', 'waitlisted'] as const).map((status) => (
          <div key={status} className="rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold">
              {status === 'confirmed' ? 'Registered participants' : 'Waitlist'} (
              {participants.filter((p) => p.status === status).length})
            </h2>
            <div className="mt-3 space-y-3">
              {participants
                .filter((p) => p.status === status)
                .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0))
                .map((p) => (
                  <div
                    key={p.registration_id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {p.avatar_url ? (
                        <Image
                          src={p.avatar_url}
                          alt=""
                          width={40}
                          height={40}
                          unoptimized
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-sm font-semibold">
                          {(p.full_name || '?')
                            .split(/\s+/)
                            .map((x) => x[0])
                            .slice(0, 2)
                            .join('')
                            .toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium">
                          {p.full_name || 'Member'}
                          {p.tennis_skill_level != null && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {p.tennis_skill_level}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {status === 'waitlisted'
                            ? `Waitlist position ${p.queue_position ?? '—'}`
                            : 'Confirmed'}
                          {status === 'confirmed' &&
                          assignments.some((a) => a.registration_id === p.registration_id)
                            ? ` · ${assignments
                                .filter((a) => a.registration_id === p.registration_id)
                                .sort((a, b) => a.segment_order - b.segment_order)
                                .map((a) => `Court ${a.court_number}`)
                                .join(' → ')}`
                            : ''}
                        </p>
                        {(p.email || p.phone) && (
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {p.email && (
                              <a className="hover:underline" href={`mailto:${p.email}`}>
                                {p.email}
                              </a>
                            )}
                            {p.phone && (
                              <a className="hover:underline" href={`tel:${p.phone}`}>
                                {p.phone}
                              </a>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    {status === 'confirmed' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <SearchableMemberSelect
                          className="w-56"
                          options={replaceOptions}
                          value={replaceFor === p.user_id ? replaceUser : ''}
                          onChange={(id) => {
                            setReplaceFor(p.user_id);
                            setReplaceUser(id);
                          }}
                          placeholder="Replace player…"
                          disabled={busy}
                        />
                        {replaceFor === p.user_id && replaceUser && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void replaceParticipant(p.user_id)}
                          >
                            Confirm
                          </Button>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void participantAction(p.user_id, 'remove')}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              {!participants.some((p) => p.status === status) && (
                <p className="text-sm text-muted-foreground">None.</p>
              )}
            </div>
          </div>
        ))}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-courts-title"
        >
          <div className="my-4 w-full max-w-6xl rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="assign-courts-title" className="text-xl font-semibold">
                  Assign courts
                </h2>
                <p className="text-sm text-muted-foreground">
                  Drag each player chip to a court. Every confirmed player must be assigned once in
                  each sub-session.
                </p>
              </div>
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                Close
              </Button>
            </div>
            <div className="mt-5 space-y-6">
              {sessions.map((session, si) => (
                <section key={si} className="rounded-lg border border-border p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Sub-session {si + 1}</h3>
                    {sessions.length > 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSessions((old) => old.filter((_, i) => i !== si))}
                      >
                        Remove sub-session
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[1, 2, 3, 4].map((court) => (
                      <div
                        key={court}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragging) movePlayer(dragging, court, si);
                        }}
                        className="min-h-44 rounded-lg border-2 border-dashed border-border bg-muted/20 p-3"
                      >
                        <h4 className="mb-3 text-sm font-semibold">
                          Court {court}{' '}
                          <span className="font-normal text-muted-foreground">
                            ({session[court].length}/4)
                          </span>
                        </h4>
                        <div className="space-y-2">
                          {session[court].map((id) => {
                            const p = participants.find((x) => x.registration_id === id);
                            if (!p) return null;
                            return (
                              <div
                                key={id}
                                draggable
                                onDragStart={() => setDragging(id)}
                                onDragEnd={() => setDragging(null)}
                                className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background p-2 shadow-sm active:cursor-grabbing"
                              >
                                {p.avatar_url ? (
                                  <Image
                                    src={p.avatar_url}
                                    alt=""
                                    width={40}
                                    height={40}
                                    unoptimized
                                    className="h-10 w-10 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold">
                                    {(p.full_name || '?')
                                      .split(/\s+/)
                                      .map((x) => x[0])
                                      .slice(0, 2)
                                      .join('')
                                      .toUpperCase()}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{p.full_name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    W:{records[p.user_id]?.wins ?? 0}, - L:
                                    {records[p.user_id]?.losses ?? 0} ·{' '}
                                    {p.tennis_skill_level ?? '—'}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  aria-label={`Unassign ${p.full_name}`}
                                  className="ml-auto text-muted-foreground"
                                  onClick={() =>
                                    setSessions((old) =>
                                      old.map((s, i) =>
                                        i === si
                                          ? { ...s, [court]: s[court].filter((x) => x !== id) }
                                          : s,
                                      ),
                                    )
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-lg bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Unassigned players
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {participants
                        .filter(
                          (p) =>
                            p.status === 'confirmed' &&
                            ![1, 2, 3, 4].some((c) => session[c].includes(p.registration_id)),
                        )
                        .map((p) => (
                          <div
                            key={p.registration_id}
                            draggable
                            onDragStart={() => setDragging(p.registration_id)}
                            onDragEnd={() => setDragging(null)}
                            className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background p-2"
                          >
                            <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-sm font-semibold">
                              {(p.full_name || '?')
                                .split(/\s+/)
                                .map((x) => x[0])
                                .slice(0, 2)
                                .join('')
                                .toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{p.full_name}</p>
                              <p className="text-xs text-muted-foreground">
                                W:{records[p.user_id]?.wins ?? 0}, - L:
                                {records[p.user_id]?.losses ?? 0} · {p.tennis_skill_level ?? '—'}
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </section>
              ))}
              <Button variant="outline" onClick={addSession}>
                Add sub-session
              </Button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void saveAllCourts()}>
                {busy ? <TennisLoader compact label="Saving" /> : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmation && (
        <ConfirmDialog
          open
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          destructive={confirmation.destructive}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.onConfirm;
            setConfirmation(null);
            action();
          }}
        />
      )}
    </section>
  );
}
