import type { Dispatch, SetStateAction } from 'react';
import { phaseStartAfterPrerequisites } from '@/lib/tournament-schedule';
import { pairMatchPlayerRows } from '@/lib/tournament-match';
import { effectiveTournamentGroup } from '@/lib/tournament-groups';
import type { TournamentConfig } from '@/lib/tournament-config';
import type { Match, Pair, Team } from '@/components/tournament-management-types';

type ScheduleArgs = {
  db: ReturnType<typeof import('@/lib/supabase-browser').createSupabaseBrowserClient>;
  eventId: string;
  eventStartsAt: string;
  eventEndsAt: string | null;
  courtCount: number;
  config: TournamentConfig | null;
  isTeam: boolean;
  activeCategory: string;
  matchCategory: string;
  matchPhase: string;
  matches: Match[];
  pairs: Pair[];
  teams: Team[];
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  refresh: () => Promise<void>;
  scheduleTimings: { duration: number; breakMinutes: number };
  participantIdsForMatch: (match: Match) => Set<string>;
  insertMatchPlayers: (assignments: ReturnType<typeof pairMatchPlayerRows>) => Promise<void>;
};

export function createTournamentScheduleAction(args: ScheduleArgs) {
  const {
    db,
    eventId,
    eventStartsAt,
    eventEndsAt,
    courtCount,
    config,
    isTeam,
    activeCategory,
    matchCategory,
    matchPhase,
    matches,
    pairs,
    teams,
    setBusy,
    setError,
    setMessage,
    refresh,
    scheduleTimings,
    participantIdsForMatch,
    insertMatchPlayers,
  } = args;
  async function generateSchedule() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const phase = matchPhase;
      const category = isTeam ? matchCategory : activeCategory;
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
          const groupNumber = effectiveTournamentGroup(side.group_number, config);
          if (!groupNumber) continue;
          groups.set(groupNumber, [...(groups.get(groupNumber) ?? []), side]);
        }
        if (sides.some((side) => !effectiveTournamentGroup(side.group_number, config))) {
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
              effectiveTournamentGroup(m.group_number, config) ?? 0,
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
  return generateSchedule;
}
