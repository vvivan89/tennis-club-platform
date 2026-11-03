import {
  calculateLadderSession,
  normalizeLadderScores,
  type LadderMetric,
} from '@/lib/social-doubles-ladder';
import type { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { Participant, Session } from '@/components/event-edit-types';

type LadderConfig = { id: string; ranking_priority: string[]; position_points: number[] };

type AssignLadderCourtsContext = {
  db: ReturnType<typeof createSupabaseBrowserClient>;
  ladderConfig: LadderConfig | null;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  participants: Participant[];
  setLadderStandings: (
    rows: Array<{ userId: string; name: string; points: number | null }>,
  ) => void;
  setSessions: (sessions: Session[]) => void;
  setMessage: (message: string) => void;
};

export function createAssignLadderCourts(context: AssignLadderCourtsContext) {
  const {
    db,
    ladderConfig,
    setBusy,
    setError,
    participants,
    setLadderStandings,
    setSessions,
    setMessage,
  } = context;
  return async function assignLadderCourts() {
    if (!ladderConfig) return;
    setBusy(true);
    setError('');
    try {
      const { data: ladderEvents, error: eventError } = await db
        .from('events')
        .select('id')
        .eq('social_doubles_ladder_id', ladderConfig.id)
        .lte('starts_at', new Date().toISOString());
      if (eventError) throw eventError;
      const ids = (ladderEvents ?? []).map((e) => e.id);
      const { data: scoreRows, error: scoreError } = ids.length
        ? await db
            .from('event_scores')
            .select(
              'event_id,player_one_registration_id,player_two_registration_id,player_three_registration_id,player_four_registration_id,player_one_score,player_two_score',
            )
            .in('event_id', ids)
        : { data: [], error: null };
      if (scoreError) throw scoreError;
      const regIds = [
        ...new Set(
          (scoreRows ?? []).flatMap((row) =>
            [
              row.player_one_registration_id,
              row.player_two_registration_id,
              row.player_three_registration_id,
              row.player_four_registration_id,
            ].filter(Boolean),
          ),
        ),
      ];
      const { data: regs, error: regError } = regIds.length
        ? await db.from('registrations').select('id,user_id').in('id', regIds)
        : { data: [], error: null };
      if (regError) throw regError;
      const userByRegistration = new Map((regs ?? []).map((r) => [r.id, r.user_id]));
      const names = Object.fromEntries(participants.map((p) => [p.user_id, p.full_name]));
      const byCourtSession = new Map<string, typeof scoreRows>();
      for (const row of scoreRows ?? []) {
        const playerSet = [
          row.player_one_registration_id,
          row.player_two_registration_id,
          row.player_three_registration_id,
          row.player_four_registration_id,
        ]
          .filter(Boolean)
          .sort()
          .join(',');
        const key = `${row.event_id}:${playerSet}`;
        const list = byCourtSession.get(key) ?? [];
        list.push(row);
        byCourtSession.set(key, list);
      }
      const totalPoints = new Map<string, number>();
      const currentPoints = new Map<string, number>();
      const totals = new Map<
        string,
        { setsWon: number; setsLost: number; gamesWon: number; gamesLost: number }
      >();
      for (const rows of byCourtSession.values()) {
        const normalized = normalizeLadderScores(rows ?? [], userByRegistration);
        const result = calculateLadderSession(
          normalized,
          names,
          ladderConfig.ranking_priority as LadderMetric[],
          [
            ladderConfig.position_points[0] ?? 2,
            ladderConfig.position_points[1] ?? 1,
            ladderConfig.position_points[2] ?? -1,
            ladderConfig.position_points[3] ?? -2,
          ],
        );
        for (const player of result) {
          currentPoints.set(
            player.playerId,
            (currentPoints.get(player.playerId) ?? 0) + player.points,
          );
          const prior = totals.get(player.playerId) ?? {
            setsWon: 0,
            setsLost: 0,
            gamesWon: 0,
            gamesLost: 0,
          };
          prior.setsWon += player.setsWon;
          prior.setsLost += player.setsLost;
          prior.gamesWon += player.gamesWon;
          prior.gamesLost += player.gamesLost;
          totals.set(player.playerId, prior);
        }
      }
      const [{ data: ladderMeta }, { data: seedRows }] = await Promise.all([
        db
          .from('social_doubles_ladders')
          .select('carryover_mode')
          .eq('id', ladderConfig.id)
          .maybeSingle(),
        db
          .from('social_doubles_ladder_seeds')
          .select('user_id,initial_position,initial_points')
          .eq('ladder_id', ladderConfig.id),
      ]);
      const seedByUser = new Map((seedRows ?? []).map((seed) => [seed.user_id, seed]));
      for (const [userId, points] of currentPoints) {
        const seed = seedByUser.get(userId);
        totalPoints.set(
          userId,
          points + (ladderMeta?.carryover_mode === 'full' ? (seed?.initial_points ?? 0) : 0),
        );
      }
      if (ladderMeta?.carryover_mode === 'full')
        for (const seed of seedRows ?? []) {
          if (!totalPoints.has(seed.user_id)) totalPoints.set(seed.user_id, seed.initial_points);
        }
      const confirmed = participants.filter((p) => p.status === 'confirmed');
      confirmed.sort((a, b) => {
        const aRanked =
            currentPoints.has(a.user_id) ||
            (ladderMeta?.carryover_mode === 'full' && seedByUser.has(a.user_id)),
          bRanked =
            currentPoints.has(b.user_id) ||
            (ladderMeta?.carryover_mode === 'full' && seedByUser.has(b.user_id));
        if (aRanked !== bRanked) return aRanked ? -1 : 1;
        if (!aRanked && !bRanked) {
          const seedDelta =
            (seedByUser.get(a.user_id)?.initial_position ?? Number.MAX_SAFE_INTEGER) -
            (seedByUser.get(b.user_id)?.initial_position ?? Number.MAX_SAFE_INTEGER);
          if (seedDelta) return seedDelta;
        }
        const pointsDelta = (totalPoints.get(b.user_id) ?? 0) - (totalPoints.get(a.user_id) ?? 0);
        if (pointsDelta) return pointsDelta;
        for (const metric of ladderConfig.ranking_priority as LadderMetric[]) {
          const value = (id: string) => {
            const t = totals.get(id) ?? { setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0 };
            if (metric === 'sets_won') return t.setsWon;
            if (metric === 'games_won') return t.gamesWon;
            if (metric === 'games_difference') return t.gamesWon - t.gamesLost;
            return t.setsWon - t.setsLost;
          };
          const delta = value(b.user_id) - value(a.user_id);
          if (delta) return delta;
        }
        return a.full_name.localeCompare(b.full_name);
      });
      setLadderStandings(
        confirmed.map((player) => ({
          userId: player.user_id,
          name: player.full_name,
          points:
            currentPoints.has(player.user_id) ||
            (ladderMeta?.carryover_mode === 'full' && totalPoints.has(player.user_id))
              ? totalPoints.get(player.user_id)!
              : null,
        })),
      );
      const courtCount = Math.max(1, Math.ceil(confirmed.length / 4));
      if (courtCount > 4)
        throw new Error(
          'This event supports up to four courts for automatic ladder assignment. Assign additional courts manually.',
        );
      const groups: Session[] = [{ 1: [], 2: [], 3: [], 4: [] }];
      confirmed.forEach((player, index) => {
        const court = Math.floor(index / 4) + 1;
        for (const group of groups) group[court as 1 | 2 | 3 | 4].push(player.registration_id);
      });
      setSessions(groups);
      setMessage('Ladder courts assigned from current standings. Review and save to apply.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not calculate ladder court assignments.');
    } finally {
      setBusy(false);
    }
  };
}
