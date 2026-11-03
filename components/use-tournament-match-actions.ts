import type { Dispatch, SetStateAction } from 'react';
import type { FormEvent } from 'react';
import { phaseStartAfterPrerequisites } from '@/lib/tournament-schedule';
import { pairMatchPlayerRows } from '@/lib/tournament-match';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { TournamentConfig } from '@/lib/tournament-config';
import type {
  Match,
  MatchPlayer,
  Pair,
  Participant,
  Team,
} from '@/components/tournament-management-types';

type Db = ReturnType<typeof createSupabaseBrowserClient>;
type ActionResult = { error: { message: string } | null };
type PendingScheduleConflicts = { match: Match; changes: Partial<Match>; conflicts: Match[] };
type State = {
  matches: Match[];
  pairs: Pair[];
  teams: Team[];
  participants: Participant[];
  matchPlayers: MatchPlayer[];
  matchCategory: string;
  matchPhase: string;
  matchOne: string;
  matchTwo: string;
  matchTime: string;
  matchCourt: string;
  teamPairSelection: Record<string, { first: string; second: string }>;
  pendingScheduleConflicts: PendingScheduleConflicts | null;
};
type Setters = {
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setMatchCourt: Dispatch<SetStateAction<string>>;
  setMatchTime: Dispatch<SetStateAction<string>>;
  setPendingScheduleConflicts: Dispatch<SetStateAction<PendingScheduleConflicts | null>>;
};

export function useTournamentMatchActions({
  db,
  eventId,
  eventStartsAt,
  eventEndsAt,
  courtCount,
  format,
  config,
  isTeam,
  activeCategory,
  state,
  setters,
  refresh,
  runAction,
  localDateTime,
  matchSideValue,
  scheduleTimings,
}: {
  db: Db;
  eventId: string;
  eventStartsAt: string;
  eventEndsAt: string | null;
  courtCount: number;
  format: string | null;
  config: TournamentConfig | null;
  isTeam: boolean;
  activeCategory: string;
  state: State;
  setters: Setters;
  refresh: () => Promise<void>;
  runAction: (action: () => PromiseLike<ActionResult>, success: string) => Promise<boolean>;
  localDateTime: (value: string | null) => string;
  matchSideValue: (match: Match, side: 1 | 2) => string;
  scheduleTimings: { duration: number; breakMinutes: number };
}) {
  const {
    matches,
    pairs,
    teams,
    participants,
    matchPlayers,
    matchCategory,
    matchPhase,
    matchOne,
    matchTwo,
    matchTime,
    matchCourt,
    teamPairSelection,
    pendingScheduleConflicts,
  } = state;
  const {
    setBusy,
    setError,
    setMessage,
    setMatchCourt,
    setMatchTime,
    setPendingScheduleConflicts,
  } = setters;
  async function saveTeamPairing(match: Match, teamId: string, side: 1 | 2) {
    if (match.status === 'completed' || match.status === 'cancelled') {
      setError('Completed match pairings are preserved as historical records.');
      return;
    }
    const selection = teamPairSelection[`${match.id}-${side}`];
    const currentPair = matchPlayers.filter(
      (player) => player.match_id === match.id && player.team_id === teamId,
    );
    const first = selection?.first ?? currentPair[0]?.participant_id ?? '';
    const second = selection?.second ?? currentPair[1]?.participant_id ?? '';
    if (!first || !second || first === second) {
      setError('Select two different players from the same team.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: deleteError } = await db
        .from('tournament_match_players')
        .delete()
        .eq('match_id', match.id)
        .eq('team_id', teamId);
      if (deleteError) throw new Error(deleteError.message);
      const { error: insertError } = await db.from('tournament_match_players').insert([
        { match_id: match.id, participant_id: first, side, team_id: teamId },
        { match_id: match.id, participant_id: second, side, team_id: teamId },
      ]);
      if (insertError) throw new Error(insertError.message);
      setMessage('Team doubles pairing saved.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save team pairing.');
    } finally {
      setBusy(false);
    }
  }

  async function createMatch(e: FormEvent) {
    e.preventDefault();
    const teamMatch = format === 'team';
    const firstSlot = matchOne.startsWith('slot:') ? matchOne.slice(5) : null;
    const secondSlot = matchTwo.startsWith('slot:') ? matchTwo.slice(5) : null;
    const firstIsBye = matchOne === 'bye';
    const secondIsBye = matchTwo === 'bye';
    const byeSide = firstIsBye ? 1 : secondIsBye ? 2 : null;
    const firstId = firstSlot || firstIsBye ? null : matchOne;
    const secondId = secondSlot || secondIsBye ? null : matchTwo;
    if (!matchOne || !matchTwo || matchOne === matchTwo) {
      setError('Select two different sides.');
      return;
    }
    if (byeSide && (!matchPhase.includes('knockout') || (firstIsBye && secondIsBye))) {
      setError('BYE can only be used once in a knockout match.');
      return;
    }
    const byeOpposingSideSelected =
      byeSide === 1 ? !!(secondId || secondSlot) : byeSide === 2 ? !!(firstId || firstSlot) : false;
    if (byeSide && !byeOpposingSideSelected) {
      setError('Select a player pair, team, or defined group slot opposite BYE.');
      return;
    }
    if ((firstSlot || secondSlot) && !matchPhase.includes('knockout')) {
      setError('Group placeholder slots can only be used in knockout matches.');
      return;
    }
    if (matchTime && !byeSide && !isValidSchedule(matchTime)) return;
    const inferredGroup = isTeam
      ? teams.find((t) => t.id === firstId)?.group_number
      : pairs.find((p) => p.id === firstId)?.group_number;
    const secondGroup = isTeam
      ? teams.find((t) => t.id === secondId)?.group_number
      : pairs.find((p) => p.id === secondId)?.group_number;
    if (
      !byeSide &&
      matchPhase.includes('round_robin') &&
      (!inferredGroup || !secondGroup || inferredGroup !== secondGroup)
    ) {
      setError('Round-robin matches must be between two entries assigned to the same group.');
      return;
    }
    const payload: Record<string, unknown> = {
      event_id: eventId,
      category: matchCategory,
      phase: matchPhase,
      group_number: matchPhase.includes('round_robin') ? (inferredGroup ?? null) : null,
      scheduled_at: byeSide ? null : matchTime ? new Date(matchTime).toISOString() : null,
      court_number: byeSide ? null : matchCourt ? Number(matchCourt) : null,
      status: byeSide ? 'bye' : 'scheduled',
      winner_side: byeSide === 1 ? 2 : byeSide === 2 ? 1 : null,
      match_number:
        matches.filter((m) => m.phase === matchPhase && m.category === matchCategory).length + 1,
      notes: JSON.stringify({ slot_one: firstSlot, slot_two: secondSlot }),
    };
    if (teamMatch) {
      payload.team_one_id = firstId;
      payload.team_two_id = secondId;
    } else {
      payload.pair_one_id = firstId;
      payload.pair_two_id = secondId;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data: createdMatch, error: createError } = await db
        .from('tournament_matches')
        .insert(payload)
        .select('id')
        .single();
      if (createError || !createdMatch)
        throw new Error(createError?.message || 'Could not create match.');
      if (!teamMatch) {
        const firstPair = firstId ? pairs.find((pair) => pair.id === firstId) : null;
        const secondPair = secondId ? pairs.find((pair) => pair.id === secondId) : null;
        const playerAssignments = [
          ...(firstPair
            ? [
                {
                  match_id: createdMatch.id,
                  participant_id: firstPair.player_one_id,
                  side: 1,
                  team_id: null,
                },
                {
                  match_id: createdMatch.id,
                  participant_id: firstPair.player_two_id,
                  side: 1,
                  team_id: null,
                },
              ]
            : []),
          ...(secondPair
            ? [
                {
                  match_id: createdMatch.id,
                  participant_id: secondPair.player_one_id,
                  side: 2,
                  team_id: null,
                },
                {
                  match_id: createdMatch.id,
                  participant_id: secondPair.player_two_id,
                  side: 2,
                  team_id: null,
                },
              ]
            : []),
        ];
        if (playerAssignments.length) {
          const { error: playersError } = await db
            .from('tournament_match_players')
            .insert(playerAssignments);
          if (playersError) {
            await db.from('tournament_matches').delete().eq('id', createdMatch.id);
            throw new Error(playersError.message);
          }
        }
      }
      setMessage('Match created.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create match.');
    } finally {
      setBusy(false);
    }
    setMatchTime('');
    setMatchCourt('');
  }
  function isValidSchedule(value: string) {
    const scheduled = new Date(value);
    const start = new Date(eventStartsAt);
    const end = new Date(eventEndsAt || eventStartsAt);
    if (Number.isNaN(scheduled.getTime()) || scheduled < start || scheduled > end) {
      setError('Match time must fall within the tournament dates.');
      return false;
    }
    if (
      scheduled.getHours() < 8 ||
      scheduled.getHours() > 21 ||
      (scheduled.getHours() === 21 && scheduled.getMinutes() > 0)
    ) {
      setError('Matches may start no earlier than 8:00 AM and no later than 9:00 PM.');
      return false;
    }
    setError('');
    return true;
  }
  function participantIdsForMatch(candidate: Match) {
    const assigned = matchPlayers
      .filter((player) => player.match_id === candidate.id)
      .map((player) => player.participant_id);
    const participantIds = assigned.length
      ? assigned
      : !isTeam
        ? (() => {
            const one = pairs.find((pair) => pair.id === candidate.pair_one_id);
            const two = pairs.find((pair) => pair.id === candidate.pair_two_id);
            return [
              one?.player_one_id,
              one?.player_two_id,
              two?.player_one_id,
              two?.player_two_id,
            ].filter((id): id is string => !!id);
          })()
        : [];
    return new Set(
      participantIds.map((id) => {
        const participant = participants.find((item) => item.id === id);
        if (participant?.user_id) return `user:${participant.user_id}`;
        if (participant?.email?.trim()) return `email:${participant.email.trim().toLowerCase()}`;
        return `participant:${id}`;
      }),
    );
  }
  async function insertMatchPlayers(assignments: ReturnType<typeof pairMatchPlayerRows>) {
    if (!assignments.length) return;
    const { error: playerError } = await db.from('tournament_match_players').insert(assignments);
    if (playerError) throw new Error(playerError.message);
  }
  async function saveMatch(match: Match, changes: Partial<Match>): Promise<boolean> {
    const updateMatchRow = () =>
      runAction(
        () =>
          db
            .from('tournament_matches')
            .update({ ...changes, updated_at: new Date().toISOString() })
            .eq('id', match.id),
        changes.score_sets ? '' : 'Match updated.',
      );
    if (changes.scheduled_at && !isValidSchedule(localDateTime(changes.scheduled_at))) return false;
    if (changes.scheduled_at || changes.court_number !== undefined) {
      const proposedScheduledAt = changes.scheduled_at ?? match.scheduled_at;
      if (!proposedScheduledAt) return updateMatchRow();
      const start = new Date(proposedScheduledAt).getTime();
      const court = changes.court_number ?? match.court_number;
      const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60));
      const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15));
      const proposedPlayers = participantIdsForMatch(match);
      const conflicts = matches.filter((other) => {
        if (other.id === match.id || other.status === 'cancelled' || !other.scheduled_at)
          return false;
        const otherStart = new Date(other.scheduled_at).getTime();
        const courtConflict =
          !!court &&
          other.court_number === court &&
          start < otherStart + (duration + gap) * 60000 &&
          otherStart < start + (duration + gap) * 60000;
        const otherPlayers = participantIdsForMatch(other);
        const playerConflict =
          [...proposedPlayers].some((id) => otherPlayers.has(id)) &&
          start < otherStart + (duration + gap) * 60000 &&
          otherStart < start + (duration + gap) * 60000;
        return courtConflict || playerConflict;
      });
      if (conflicts.length) {
        setPendingScheduleConflicts({
          match,
          changes,
          conflicts: conflicts.sort(
            (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
          ),
        });
        return false;
      }
    }
    return updateMatchRow();
  }
  async function confirmResolveScheduleConflicts() {
    if (!pendingScheduleConflicts) return;
    const { match, changes, conflicts } = pendingScheduleConflicts;
    setPendingScheduleConflicts(null);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const targetStart = new Date(changes.scheduled_at ?? match.scheduled_at ?? '').getTime();
      const duration = Math.max(30, Number(config?.schedule?.match_minutes ?? 60));
      const gap = Math.max(10, Number(config?.schedule?.break_minutes ?? 15));
      const court = changes.court_number ?? match.court_number;
      const { error: targetError } = await db
        .from('tournament_matches')
        .update({ ...changes, updated_at: new Date().toISOString() })
        .eq('id', match.id);
      if (targetError) throw new Error(targetError.message);
      let cursor = targetStart + (duration + gap) * 60000;
      const end = new Date(eventEndsAt || eventStartsAt).getTime();
      for (const conflict of conflicts) {
        const conflictCourt = court ?? conflict.court_number;
        let next = new Date(cursor);
        if (next.getHours() >= 21 || next.getHours() < 8) {
          next.setDate(next.getDate() + (next.getHours() >= 21 ? 1 : 0));
          next.setHours(8, 0, 0, 0);
        }
        while (
          next.getTime() + duration * 60000 > end ||
          matches.some((other) => {
            if (
              other.id === conflict.id ||
              other.id === match.id ||
              !other.scheduled_at ||
              other.status === 'cancelled'
            )
              return false;
            const otherStart = new Date(other.scheduled_at).getTime();
            const courtConflict =
              other.court_number === conflictCourt &&
              !!conflictCourt &&
              next.getTime() < otherStart + (duration + gap) * 60000 &&
              otherStart < next.getTime() + (duration + gap) * 60000;
            const nextPlayers = participantIdsForMatch(conflict);
            const otherPlayers = participantIdsForMatch(other);
            const playerConflict =
              [...nextPlayers].some((id) => otherPlayers.has(id)) &&
              next.getTime() < otherStart + (duration + gap) * 60000 &&
              otherStart < next.getTime() + (duration + gap) * 60000;
            return courtConflict || playerConflict;
          })
        ) {
          next = new Date(next.getTime() + 15 * 60000);
          if (next.getHours() >= 21) {
            next.setDate(next.getDate() + 1);
            next.setHours(8, 0, 0, 0);
          }
          if (next.getTime() + duration * 60000 > end)
            throw new Error(
              'Conflicting matches cannot all be moved within the tournament dates. Extend the tournament dates or move matches manually.',
            );
        }
        const { error: shiftError } = await db
          .from('tournament_matches')
          .update({
            scheduled_at: next.toISOString(),
            court_number: conflictCourt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conflict.id);
        if (shiftError) throw new Error(shiftError.message);
        cursor = next.getTime() + (duration + gap) * 60000;
      }
      setMessage(
        `Moved ${conflicts.length} conflicting match${conflicts.length === 1 ? '' : 'es'} to avoid overlap.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resolve schedule conflicts.');
    } finally {
      setBusy(false);
    }
  }
  async function changeMatchSide(match: Match, side: 1 | 2, newId: string) {
    if (!newId || match.status === 'completed') return;
    const teamMatch = format === 'team';
    const isByeSelection = newId === 'bye';
    const slotLabel = newId.startsWith('slot:') ? newId.slice(5) : null;
    const selectedId = slotLabel || isByeSelection ? null : newId;
    const field = teamMatch
      ? side === 1
        ? 'team_one_id'
        : 'team_two_id'
      : side === 1
        ? 'pair_one_id'
        : 'pair_two_id';
    const otherId = teamMatch
      ? side === 1
        ? match.team_two_id
        : match.team_one_id
      : side === 1
        ? match.pair_two_id
        : match.pair_one_id;
    let otherSlotLabel: string | null = null;
    try {
      const otherNotes = JSON.parse(match.notes || '{}') as {
        slot_one?: string | null;
        slot_two?: string | null;
      };
      otherSlotLabel = side === 1 ? (otherNotes.slot_two ?? null) : (otherNotes.slot_one ?? null);
    } catch {
      otherSlotLabel = null;
    }
    const otherIsBye = matchSideValue(match, side === 1 ? 2 : 1) === 'bye';
    if ((selectedId && selectedId === otherId) || (slotLabel && slotLabel === otherSlotLabel)) {
      setError('A match must have two different sides.');
      return;
    }
    if (
      isByeSelection &&
      (!match.phase.includes('knockout') || otherIsBye || (!otherId && !otherSlotLabel))
    ) {
      setError('BYE can only be assigned once in a knockout match with an opposing side selected.');
      return;
    }
    if (match.phase.includes('round_robin') && selectedId) {
      const selectedGroup = teamMatch
        ? teams.find((team) => team.id === selectedId)?.group_number
        : pairs.find((pair) => pair.id === selectedId)?.group_number;
      const otherGroup = teamMatch
        ? teams.find((team) => team.id === otherId)?.group_number
        : pairs.find((pair) => pair.id === otherId)?.group_number;
      if (!selectedGroup || selectedGroup !== otherGroup) {
        setError('Round-robin matches must be between entries in the same group.');
        return;
      }
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let notes: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(match.notes || '{}') as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') notes = parsed;
      } catch {
        notes = {};
      }
      notes[side === 1 ? 'slot_one' : 'slot_two'] = slotLabel;
      const { error: updateError } = await db
        .from('tournament_matches')
        .update({
          [field]: selectedId,
          status:
            isByeSelection || otherIsBye
              ? 'bye'
              : match.status === 'bye'
                ? 'scheduled'
                : match.status,
          winner_side: isByeSelection
            ? side === 1
              ? 2
              : 1
            : otherIsBye
              ? side
              : match.status === 'bye'
                ? null
                : match.winner_side,
          scheduled_at:
            isByeSelection || otherIsBye
              ? null
              : match.status === 'bye'
                ? null
                : match.scheduled_at,
          court_number:
            isByeSelection || otherIsBye
              ? null
              : match.status === 'bye'
                ? null
                : match.court_number,
          score_sets:
            isByeSelection || otherIsBye || match.status === 'bye' ? [] : match.score_sets,
          notes: JSON.stringify(notes),
          updated_at: new Date().toISOString(),
        })
        .eq('id', match.id);
      if (updateError) throw new Error(updateError.message);
      if (!teamMatch) {
        const { error: deleteError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('match_id', match.id)
          .eq('side', side);
        if (deleteError) throw new Error(deleteError.message);
        const pair = selectedId ? pairs.find((item) => item.id === selectedId) : null;
        if (pair) {
          const { error: insertError } = await db.from('tournament_match_players').insert([
            { match_id: match.id, participant_id: pair.player_one_id, side, team_id: null },
            { match_id: match.id, participant_id: pair.player_two_id, side, team_id: null },
          ]);
          if (insertError) throw new Error(insertError.message);
        }
      }
      setMessage('Match draw updated.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update match draw.');
    } finally {
      setBusy(false);
    }
  }
  async function generateSchedule() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const phase = matchPhase;
      const category = isTeam ? 'team' : activeCategory;
      let currentMatches = [...matches];
      if (phase === 'round_robin' || phase === 'team_round_robin') {
        const sides = (
          isTeam
            ? teams
            : pairs.filter(
                (pair) => pair.status !== 'withdrawn' && pair.category === activeCategory,
              )
        ).filter(
          (side, index, all) => all.findIndex((candidate) => candidate.id === side.id) === index,
        );
        const groups = new Map<number, Array<(typeof sides)[number]>>();
        for (const side of sides) {
          const groupNumber = side.group_number;
          if (!groupNumber) continue;
          groups.set(groupNumber, [...(groups.get(groupNumber) ?? []), side]);
        }
        if (sides.some((side) => !side.group_number)) {
          throw new Error(
            'Assign every team or doubles pair to a group before suggesting the round-robin schedule.',
          );
        }
        const existing = currentMatches.filter(
          (m) => m.category === category && m.phase === phase && m.status !== 'cancelled',
        );
        const rows: Record<string, unknown>[] = [];
        const keyFor = (a: string, b: string, group: number) => [group, ...[a, b].sort()].join(':');
        const existingKeys = new Set(
          existing.map((m) =>
            keyFor(
              (isTeam ? m.team_one_id : m.pair_one_id) || '',
              (isTeam ? m.team_two_id : m.pair_two_id) || '',
              m.group_number ?? 0,
            ),
          ),
        );
        for (const [groupNumber, groupSides] of groups) {
          for (let i = 0; i < groupSides.length; i++) {
            for (let j = i + 1; j < groupSides.length; j++) {
              const one = groupSides[i];
              const two = groupSides[j];
              const matchupKey = keyFor(one.id, two.id, groupNumber);
              if (existingKeys.has(matchupKey)) continue;
              existingKeys.add(matchupKey);
              rows.push({
                event_id: eventId,
                category,
                phase,
                group_number: groupNumber,
                round_number: 1,
                match_number: existing.length + rows.length + 1,
                status: 'scheduled',
                ...(isTeam
                  ? { team_one_id: one.id, team_two_id: two.id }
                  : { pair_one_id: one.id, pair_two_id: two.id }),
              });
            }
          }
        }
        if (rows.length) {
          const { data: created, error: insertError } = await db
            .from('tournament_matches')
            .insert(rows)
            .select('*');
          if (insertError) throw new Error(insertError.message);
          const createdMatches = (created ?? []) as Match[];
          if (!isTeam && createdMatches.length) {
            await insertMatchPlayers(
              createdMatches.flatMap((match) => pairMatchPlayerRows(match, pairs)),
            );
          }
          currentMatches = [...currentMatches, ...createdMatches];
        }
      }
      const pending = currentMatches.filter(
        (m) =>
          m.category === category &&
          m.phase === phase &&
          m.status !== 'cancelled' &&
          !m.scheduled_at,
      );
      const end = new Date(eventEndsAt || eventStartsAt);
      const { duration, breakMinutes } = scheduleTimings;
      // Sequence phases from the end of every prerequisite match, then leave at
      // least one full hour before the next phase starts. This intentionally uses
      // the latest match across the whole preceding phase, not the first round.
      const prerequisitePhases =
        phase === 'round_robin' || phase === 'team_round_robin'
          ? ['preliminary_knockout']
          : phase === 'final_knockout'
            ? ['preliminary_knockout', 'round_robin']
            : phase === 'team_knockout'
              ? ['preliminary_knockout', 'team_round_robin']
              : [];
      const prerequisiteMatches = currentMatches.filter(
        (m) =>
          prerequisitePhases.includes(m.phase) &&
          m.category === category &&
          m.status !== 'cancelled',
      );
      const phaseStart = phaseStartAfterPrerequisites({
        baseStart: eventStartsAt,
        prerequisiteMatches,
        matchMinutes: duration,
        minimumBreakMinutes: 60,
      });
      const occupiedMatches = currentMatches.filter(
        (m) => m.scheduled_at && m.status !== 'cancelled',
      );
      const scheduled: Array<{ id: string; scheduled_at: string; court_number: number }> = [];
      for (const match of pending) {
        let cursor = new Date(phaseStart.getTime());
        cursor.setHours(
          Math.max(8, cursor.getHours()),
          cursor.getHours() < 8 ? 0 : cursor.getMinutes(),
          0,
          0,
        );
        let assigned: { scheduled_at: string; court_number: number } | null = null;
        let guard = 0;
        while (!assigned && guard++ < 4000) {
          if (cursor.getHours() < 8) cursor.setHours(8, 0, 0, 0);
          if (
            cursor.getHours() > 21 ||
            (cursor.getHours() === 21 && cursor.getMinutes() > 0) ||
            cursor.getTime() + duration * 60000 > end.getTime()
          ) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(8, 0, 0, 0);
            continue;
          }
          for (let court = 1; court <= Math.max(1, courtCount); court++) {
            const scheduledMap = new Map(scheduled.map((item) => [item.id, item.scheduled_at]));
            const candidatePlayers = participantIdsForMatch(match);
            const hasConflict = [
              ...occupiedMatches,
              ...scheduled.map(
                (item) =>
                  ({
                    ...currentMatches.find((m) => m.id === item.id)!,
                    ...item,
                    status: 'scheduled',
                  }) as Match,
              ),
            ].some((other) => {
              if (!other.scheduled_at || other.id === match.id) return false;
              const otherStart = new Date(
                scheduledMap.get(other.id) ?? other.scheduled_at,
              ).getTime();
              const sameCourtOverlap =
                other.court_number === court &&
                cursor.getTime() < otherStart + (duration + breakMinutes) * 60000 &&
                otherStart < cursor.getTime() + (duration + breakMinutes) * 60000;
              const otherPlayers = participantIdsForMatch(other);
              const playerOverlap =
                [...candidatePlayers].some((id) => otherPlayers.has(id)) &&
                cursor.getTime() < otherStart + (duration + breakMinutes) * 60000 &&
                otherStart < cursor.getTime() + (duration + breakMinutes) * 60000;
              return sameCourtOverlap || playerOverlap;
            });
            if (!hasConflict) {
              assigned = { scheduled_at: cursor.toISOString(), court_number: court };
              break;
            }
          }
          if (!assigned) cursor = new Date(cursor.getTime() + 15 * 60000);
        }
        if (!assigned)
          throw new Error(
            'Not enough available time within the tournament boundaries. Extend the event or reduce the number of matches.',
          );
        scheduled.push({ id: match.id, ...assigned });
      }
      for (const item of scheduled) {
        const { error: updateError } = await db
          .from('tournament_matches')
          .update({ scheduled_at: item.scheduled_at, court_number: item.court_number })
          .eq('id', item.id);
        if (updateError) throw new Error(updateError.message);
      }
      setMessage(
        `${scheduled.length} matches scheduled${phase.includes('round_robin') ? '; all group matchups were generated where missing' : ''}. Review and edit them below.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not suggest a schedule.');
    } finally {
      setBusy(false);
    }
  }

  return {
    saveTeamPairing,
    createMatch,
    isValidSchedule,
    participantIdsForMatch,
    insertMatchPlayers,
    saveMatch,
    confirmResolveScheduleConflicts,
    changeMatchSide,
    generateSchedule,
  };
}
