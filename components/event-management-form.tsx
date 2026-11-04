'use client';
import { useTimedFeedback } from '@/hooks/use-timed-feedback';
import { TennisLoader } from '@/components/tennis-loader';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requireBrowserUser } from '@/lib/supabase-browser-user';
import { dispatchEventNotificationsInBackground } from '@/lib/event-notifications';
import {
  calculateLadderSession,
  normalizeLadderScores,
  type LadderMetric,
} from '@/lib/social-doubles-ladder';
import { Button } from '@/components/ui/button';
import { FloatingFeedback } from '@/components/floating-feedback';
import { EventBasicsFields } from '@/components/event-basics-fields';
import { EventCompetitionFields } from '@/components/event-competition-fields';
import { EventSchedulingFields } from '@/components/event-scheduling-fields';
import { useEventFormLadders } from '@/components/use-event-form-ladders';
import { type EventFormValues, type OrganizerOption } from '@/components/event-form-types';
import {
  generateRulesText,
  getFirstSeriesDate,
  getEventTypeFormUpdate,
  initialEventFormValues as initial,
  leagueTournamentConfig,
  localValue,
  previewRegistrationWeekday,
  seedEventSeriesFields,
} from '@/components/event-form-defaults';

export function EventManagementForm({
  event,
  currentUserId = '',
  organizerOptions = [],
  showOrganizerField = false,
}: {
  event?: Partial<EventFormValues> & {
    id?: string;
    created_by?: string | null;
    social_doubles_ladder_id?: string | null;
    is_league_tournament?: boolean;
    league_name?: string | null;
    ladder_gender?: 'male' | 'female' | null;
    ladder_position_points?: number[] | null;
    ladder_ranking_priority?: string[] | null;
  };
  currentUserId?: string;
  organizerOptions?: OrganizerOption[];
  showOrganizerField?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<EventFormValues>({
    ...initial,
    ...event,
    ladder_existing_id: event?.ladder_existing_id ?? event?.social_doubles_ladder_id ?? '',
    league_existing_id: event?.is_league_tournament ? (event?.social_doubles_ladder_id ?? '') : '',
    is_league_tournament: event?.is_league_tournament ?? false,
    ladder_name: event?.ladder_name ?? event?.league_name ?? '',
    ladder_gender:
      event?.ladder_gender ?? (event?.gender_restriction === 'female' ? 'female' : 'male'),
    ladder_points: (event?.ladder_points ??
      event?.ladder_position_points ??
      initial.ladder_points) as [number, number, number, number],
    ladder_ranking_priority: event?.ladder_ranking_priority ?? initial.ladder_ranking_priority,
    organizer_id: event?.organizer_id ?? event?.created_by ?? currentUserId,
    members_only:
      event?.event_type === 'tournament' || event?.event_type === 'party'
        ? false
        : (event?.members_only ?? true),
    description: event?.description ?? '',
    gender_restriction: event?.gender_restriction ?? null,
    location: event?.location ?? initial.location,
    notes: event?.notes ?? '',
    starts_at: localValue(event?.starts_at),
    ends_at: localValue(event?.ends_at),
    registration_opens_at: localValue(event?.registration_opens_at),
    registration_closes_at: localValue(event?.registration_closes_at),
    price_cents: event?.price_cents ?? 0,
    allow_plus_one: event?.allow_plus_one ?? false,
    guest_price_cents: event?.guest_price_cents ?? 0,
    capacity: event?.capacity ?? 16,
    court_count: event?.court_count ?? 4,
    tournament_format: event?.tournament_format ?? 'doubles',
    tournament_config: event?.tournament_config ?? initial.tournament_config,
    tournament_rules_html: event?.tournament_rules_html ?? '',
    allow_non_member_registration: event?.allow_non_member_registration ?? false,
    tournament_details_public: event?.tournament_details_public ?? true,
  });
  const [applyToSeries, setApplyToSeries] = useState(false);
  const availableLadders = useEventFormLadders();
  useEffect(() => {
    const selected = availableLadders.find((ladder) => ladder.id === v.ladder_existing_id);
    if (!selected) return;
    change('ladder_gender', selected.gender as 'male' | 'female');
    change('gender_restriction', selected.gender);
    change(
      'ladder_points',
      (selected.position_points ?? [2, 1, -1, -2]) as [number, number, number, number],
    );
    change(
      'ladder_ranking_priority',
      selected.ranking_priority ?? ['games_won', 'sets_won', 'games_difference'],
    );
  }, [v.ladder_existing_id, availableLadders]);
  useEffect(() => {
    const selected = availableLadders.find(
      (league) => league.id === v.league_existing_id && league.competition_type === 'league',
    );
    if (!selected) return;
    setV((previous) => ({
      ...previous,
      ladder_gender: selected.gender as 'male' | 'female',
      gender_restriction: selected.gender,
      ladder_name: selected.name,
      tournament_config: {
        ...(selected.tournament_config ?? previous.tournament_config),
        categories: [selected.gender === 'male' ? 'men' : 'women'],
        phases: { round_robin: true },
        group_count: 1,
        teams_per_group: 4,
        registration_mode: 'both',
      },
      tournament_rules_html: '',
    }));
  }, [v.league_existing_id, availableLadders]);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [until, setUntil] = useState('');
  const [seriesStartDate, setSeriesStartDate] = useState(
    event?.starts_at ? localValue(event.starts_at).slice(0, 10) : '',
  );
  const [dayOfWeek, setDayOfWeek] = useState(
    String(event?.starts_at ? new Date(localValue(event.starts_at)).getDay() : 6),
  );
  const [seriesStartTime, setSeriesStartTime] = useState(
    event?.starts_at ? localValue(event.starts_at).slice(11, 16) : '09:00',
  );
  const [seriesEndTime, setSeriesEndTime] = useState(
    event?.ends_at ? localValue(event.ends_at).slice(11, 16) : '10:00',
  );
  const [openDays, setOpenDays] = useState('3');
  const [openTime, setOpenTime] = useState('18:00');
  const [closeDays, setCloseDays] = useState('1');
  const [closeTime, setCloseTime] = useState('18:00');
  const { busy, setBusy, error, setError, message, setMessage } = useTimedFeedback();
  function change<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }
  const ladderOptions = availableLadders
    .filter((ladder) => ladder.gender === v.ladder_gender)
    .map((ladder) => (
      <option key={ladder.id} value={ladder.id}>
        {ladder.name}
      </option>
    ));
  function handleEventTypeChange(value: string) {
    const result = getEventTypeFormUpdate(value, v);
    setV((previous) => ({ ...previous, ...result.update }));
    if (result.recurring !== undefined) setRecurring(result.recurring);
    if (result.seedSeries)
      seedEventSeriesFields(
        v,
        setSeriesStartDate,
        setDayOfWeek,
        setSeriesStartTime,
        setSeriesEndTime,
      );
  }
  const firstSeriesDate = getFirstSeriesDate(seriesStartDate, dayOfWeek);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { db, user } = await requireBrowserUser('Sign in again to continue.');
      const starts =
        recurring && firstSeriesDate
          ? new Date(`${firstSeriesDate.toISOString().slice(0, 10)}T${seriesStartTime}`)
          : new Date(v.starts_at);
      const ends = recurring
        ? new Date(
            `${firstSeriesDate?.toISOString().slice(0, 10) ?? seriesStartDate}T${seriesEndTime}`,
          )
        : new Date(v.ends_at);
      if (recurring && !seriesStartDate)
        throw new Error('Choose a start date for the event series.');
      if (!(ends > starts)) throw new Error('The event end must be after the start time.');
      if (v.event_type === 'tournament' && recurring)
        if (!v.is_league_tournament) throw new Error('Tournament events cannot be recurring.');
      if (
        v.event_type === 'tournament' &&
        !v.is_league_tournament &&
        !(v.tournament_config.categories ?? []).length
      )
        throw new Error(
          v.tournament_format === 'team'
            ? 'Enable at least one team match category.'
            : 'Enable at least one doubles category.',
        );
      if (
        v.event_type === 'tournament' &&
        v.tournament_config.phases?.preliminary_knockout &&
        !v.tournament_config.phases?.round_robin
      )
        throw new Error('Preliminary knockout requires round robin.');
      if (!recurring) {
        if (!v.registration_closes_at) throw new Error('Set a registration cutoff date and time.');
        const openAt = new Date(v.registration_opens_at);
        const closeAt = v.registration_closes_at ? new Date(v.registration_closes_at) : null;
        if (openAt >= starts) throw new Error('Registration must open before the event starts.');
        if (closeAt && closeAt > starts)
          throw new Error('Registration cutoff must be on or before the event start.');
        if (closeAt && closeAt <= openAt)
          throw new Error('Registration cutoff must be after registration opens.');
      }
      if (v.event_type === 'social_doubles_ladder') {
        if (!['male', 'female'].includes(v.ladder_gender))
          throw new Error("Choose men's or women's ladder.");
        if (!v.ladder_existing_id) {
          const ladderName = v.ladder_name.trim();
          if (!ladderName) throw new Error('Enter a name for this ladder.');
          if (
            availableLadders.some(
              (ladder) => ladder.name.trim().toLocaleLowerCase() === ladderName.toLocaleLowerCase(),
            )
          )
            throw new Error('A ladder with this name already exists. Choose a unique ladder name.');
        }
        if (!v.ladder_ranking_priority.length)
          throw new Error('Choose at least one ranking criterion.');
        if (v.ladder_carryover !== 'none' && !v.ladder_previous_id && !v.ladder_existing_id)
          throw new Error('Choose a previous ladder for carryover.');
        if (v.ladder_existing_id) {
          const selected = availableLadders.find((ladder) => ladder.id === v.ladder_existing_id);
          if (selected && selected.gender !== v.ladder_gender)
            throw new Error('A ladder cannot mix gender categories.');
        }
      }
      if (v.is_league_tournament && v.event_type === 'tournament') {
        if (!['male', 'female'].includes(v.ladder_gender))
          throw new Error('Choose a league gender.');
        if (!v.league_existing_id && !v.ladder_name.trim())
          throw new Error('Enter a name for this league.');
      }
      if (v.event_type !== 'tournament' && v.capacity < 1)
        throw new Error('Maximum attendees must be at least 1.');
      if (v.event_type === 'tournament' && v.tournament_format !== 'team') {
        for (const [category, limit] of Object.entries(
          v.tournament_config.category_capacities ?? {},
        )) {
          if (limit != null && (!Number.isInteger(Number(limit)) || Number(limit) < 1))
            throw new Error(
              `Capacity for ${category} must be a positive whole number or left blank.`,
            );
        }
      }
      const common = {
        title: v.title.trim(),
        description: v.description.trim(),
        gender_restriction: v.event_type === 'party' ? null : v.gender_restriction || null,
        capacity:
          v.event_type === 'tournament'
            ? Number(v.capacity) > 0
              ? Number(v.capacity)
              : 1000000
            : Number(v.capacity),
        price_cents: Math.round(Number(v.price_cents)),
        allow_plus_one: v.event_type === 'party' && v.allow_plus_one,
        guest_price_cents:
          v.event_type === 'party' && v.allow_plus_one
            ? Math.round(Number(v.guest_price_cents))
            : 0,
        members_only: ['tournament', 'party'].includes(v.event_type) ? false : v.members_only,
        status: v.status,
        location: v.location.trim(),
        notes: v.notes.trim(),
        waitlist_enabled: v.event_type === 'party' ? false : v.waitlist_enabled,
        court_count: Number(v.court_count),
        event_type: v.event_type,
        ladder_gender: v.event_type === 'social_doubles_ladder' ? v.ladder_gender : null,
        ladder_position_points: v.event_type === 'social_doubles_ladder' ? v.ladder_points : null,
        ladder_ranking_priority:
          v.event_type === 'social_doubles_ladder' ? v.ladder_ranking_priority : null,
        tournament_format: v.event_type === 'tournament' ? v.tournament_format : null,
        tournament_config:
          v.event_type === 'tournament'
            ? {
                ...v.tournament_config,
                ...(v.tournament_format === 'team'
                  ? {
                      category_capacities: Object.fromEntries(
                        Object.entries(v.tournament_config.category_capacities ?? {}).filter(
                          ([category]) => category !== 'team',
                        ),
                      ),
                    }
                  : {}),
                total_capacity:
                  Number(v.capacity) > 0 && Number(v.capacity) < 1000000
                    ? Number(v.capacity)
                    : null,
              }
            : {},
        tournament_rules_html:
          v.event_type === 'tournament' && !v.is_league_tournament ? v.tournament_rules_html : '',
        allow_non_member_registration:
          v.event_type === 'tournament' ? v.allow_non_member_registration : false,
        tournament_details_public:
          v.event_type === 'tournament' ? v.tournament_details_public : false,
        social_doubles_ladder_id: v.is_league_tournament
          ? v.league_existing_id || null
          : v.event_type === 'party'
            ? null
            : undefined,
        organizer_id: showOrganizerField
          ? v.organizer_id || currentUserId
          : v.organizer_id || event?.created_by || currentUserId,
        updated_at: new Date().toISOString(),
      };
      if (v.id) {
        const datesOnly = {
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
          registration_opens_at: new Date(v.registration_opens_at).toISOString(),
          registration_closes_at: v.registration_closes_at
            ? new Date(v.registration_closes_at).toISOString()
            : null,
        };
        let notifyIds = [v.id];
        if (applyToSeries && v.series_id && v.event_type !== 'party') {
          const { error: seriesError } = await db
            .from('events')
            .update(common)
            .eq('series_id', v.series_id);
          if (seriesError) throw seriesError;
          const { error: dateError } = await db.from('events').update(datesOnly).eq('id', v.id);
          if (dateError) throw dateError;
          if (v.status === 'cancelled') {
            const { data } = await db.from('events').select('id').eq('series_id', v.series_id);
            notifyIds = (data ?? []).map((e) => e.id);
          }
        } else {
          const { error } = await db
            .from('events')
            .update({
              ...common,
              ...datesOnly,
              ...(v.event_type === 'party' ? { series_id: null } : {}),
            })
            .eq('id', v.id);
          if (error) throw error;
        }
        if (v.is_league_tournament && v.league_existing_id) {
          const { error: leagueError } = await db
            .from('social_doubles_ladders')
            .update({
              name: v.ladder_name.trim() || event?.league_name || v.title.trim(),
              gender: v.ladder_gender,
              tournament_config: leagueTournamentConfig(v.tournament_config, v.ladder_gender),
              tournament_rules_html: '',
            })
            .eq('id', v.league_existing_id);
          if (leagueError) throw leagueError;
        }
        if (v.status === 'cancelled') {
          dispatchEventNotificationsInBackground(notifyIds, 'Event management');
        }
        setMessage(
          applyToSeries && v.series_id
            ? 'Shared fields updated across the recurring series.'
            : 'Event updated.',
        );
        router.push(`/events/${v.id}`);
        router.refresh();
        return;
      }
      const dates: Date[] = [new Date(starts)];
      if (recurring) {
        if (!until) throw new Error('Choose the last date for this recurring event.');
        const endDate = new Date(`${until}T23:59:59`);
        if (endDate < starts)
          throw new Error('Repeat-until date must be on or after the first event.');
        let cursor = new Date(starts);
        let guard = 0;
        while (guard++ < 160) {
          let next: Date;
          if (frequency === 'weekly' || frequency === 'biweekly') {
            next = new Date(cursor);
            next.setDate(next.getDate() + (frequency === 'weekly' ? 7 : 14));
          } else {
            const current = new Date(cursor);
            const targetMonth = new Date(
              current.getFullYear(),
              current.getMonth() + 1,
              1,
              current.getHours(),
              current.getMinutes(),
            );
            const targetDay = Number(dayOfWeek);
            const firstDay = targetMonth.getDay();
            targetMonth.setDate(1 + ((targetDay - firstDay + 7) % 7));
            // Preserve the week-of-month ordinal when possible.
            const ordinal = Math.floor((current.getDate() - 1) / 7);
            targetMonth.setDate(targetMonth.getDate() + ordinal * 7);
            if (targetMonth.getMonth() !== (current.getMonth() + 1) % 12)
              targetMonth.setDate(targetMonth.getDate() - 7);
            next = targetMonth;
          }
          if (next > endDate) break;
          dates.push(new Date(next));
          cursor = next;
        }
        if (guard >= 160) throw new Error('The recurrence range is too long.');
      }
      const duration = ends.getTime() - starts.getTime();
      const rows = dates.map((start) => {
        const end = new Date(start.getTime() + duration);
        let opens: Date, closes: Date | null;
        if (recurring) {
          const openDate = new Date(start);
          openDate.setDate(openDate.getDate() - Number(openDays));
          const [oh, om] = openTime.split(':').map(Number);
          openDate.setHours(oh, om, 0, 0);
          opens = openDate;
          const closeDate = new Date(start);
          closeDate.setDate(closeDate.getDate() - Number(closeDays));
          const [ch, cm] = closeTime.split(':').map(Number);
          closeDate.setHours(ch, cm, 0, 0);
          closes = closeDate;
          if (opens >= start)
            throw new Error('Recurring registration must open before each event.');
          if (closes > start)
            throw new Error('Recurring registration cutoff must be on or before each event.');
        } else {
          opens = new Date(v.registration_opens_at);
          closes = v.registration_closes_at ? new Date(v.registration_closes_at) : null;
        }
        if (closes && closes <= opens)
          throw new Error('Registration cutoff must be after registration opens.');
        return {
          ...common,
          series_id: null,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          registration_opens_at: opens.toISOString(),
          registration_closes_at: closes?.toISOString() ?? null,
          created_by: user.id,
          title: dates.length > 1 ? `${v.title.trim()}` : v.title.trim(),
        };
      });
      let seriesId: string | undefined;
      if (recurring) {
        const { data: series, error } = await db
          .from('event_series')
          .insert({
            title: v.title.trim(),
            recurrence_rule: {
              frequency,
              day_of_week: Number(dayOfWeek),
              session_start_time: seriesStartTime,
              session_end_time: seriesEndTime,
              registration_open_days_before: Number(openDays),
              registration_open_time: openTime,
              registration_close_days_before: Number(closeDays),
              registration_close_time: closeTime,
            },
            starts_on:
              firstSeriesDate?.toISOString().slice(0, 10) ||
              seriesStartDate ||
              v.starts_at.slice(0, 10),
            repeats_until: until,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (error) throw error;
        seriesId = series.id;
      }
      const eventRows = rows.map((row) => ({ ...row, series_id: seriesId ?? null }));
      const { data: created, error } = await db.from('events').insert(eventRows).select('id');
      if (error) throw error;
      if (v.event_type === 'social_doubles_ladder' && created?.length) {
        let ladderId = v.ladder_existing_id;
        if (!ladderId) {
          const { data: ladder, error: ladderError } = await db
            .from('social_doubles_ladders')
            .insert({
              name: v.ladder_name.trim(),
              gender: v.ladder_gender,
              position_points: v.ladder_points,
              ranking_priority: v.ladder_ranking_priority,
              carryover_mode: v.ladder_carryover,
              previous_ladder_id:
                v.ladder_carryover === 'none' ? null : v.ladder_previous_id || null,
              starts_at: starts.toISOString(),
              ends_at: rows[rows.length - 1]?.ends_at ?? ends.toISOString(),
              created_by: user.id,
            })
            .select('id')
            .single();
          if (ladderError) throw ladderError;
          ladderId = ladder.id;
          if (v.ladder_carryover !== 'none' && v.ladder_previous_id) {
            const previous = availableLadders.find((item) => item.id === v.ladder_previous_id);
            const { data: priorEvents, error: priorEventsError } = await db
              .from('events')
              .select('id')
              .eq('social_doubles_ladder_id', v.ladder_previous_id);
            if (priorEventsError) throw priorEventsError;
            const priorEventIds = (priorEvents ?? []).map((item) => item.id);
            const { data: priorScores, error: priorScoresError } = priorEventIds.length
              ? await db
                  .from('event_scores')
                  .select(
                    'event_id,player_one_registration_id,player_two_registration_id,player_three_registration_id,player_four_registration_id,player_one_score,player_two_score',
                  )
                  .in('event_id', priorEventIds)
              : { data: [], error: null };
            if (priorScoresError) throw priorScoresError;
            const priorRegistrationIds = [
              ...new Set(
                (priorScores ?? []).flatMap((row) =>
                  [
                    row.player_one_registration_id,
                    row.player_two_registration_id,
                    row.player_three_registration_id,
                    row.player_four_registration_id,
                  ].filter(Boolean),
                ),
              ),
            ];
            const { data: priorRegistrations, error: priorRegistrationsError } =
              priorRegistrationIds.length
                ? await db.from('registrations').select('id,user_id').in('id', priorRegistrationIds)
                : { data: [], error: null };
            if (priorRegistrationsError) throw priorRegistrationsError;
            const priorUserByRegistration = new Map(
              (priorRegistrations ?? []).map((row) => [row.id, row.user_id]),
            );
            const priorGroups = new Map<string, typeof priorScores>();
            for (const row of priorScores ?? []) {
              const groupKey = `${row.event_id}:${[row.player_one_registration_id, row.player_two_registration_id, row.player_three_registration_id, row.player_four_registration_id].filter(Boolean).sort().join(',')}`;
              const group = priorGroups.get(groupKey) ?? [];
              group.push(row);
              priorGroups.set(groupKey, group);
            }
            const priorPoints = new Map<string, number>();
            const priorMetrics = new Map<
              string,
              { setsWon: number; setsLost: number; gamesWon: number; gamesLost: number }
            >();
            const names: Record<string, string> = {};
            for (const group of priorGroups.values()) {
              const normalized = normalizeLadderScores(group ?? [], priorUserByRegistration);
              const results = calculateLadderSession(
                normalized,
                names,
                (previous?.ranking_priority ?? [
                  'games_won',
                  'sets_won',
                  'games_difference',
                ]) as LadderMetric[],
                (previous?.position_points ?? [2, 1, -1, -2]) as [number, number, number, number],
              );
              for (const result of results) {
                priorPoints.set(
                  result.playerId,
                  (priorPoints.get(result.playerId) ?? 0) + result.points,
                );
                const totals = priorMetrics.get(result.playerId) ?? {
                  setsWon: 0,
                  setsLost: 0,
                  gamesWon: 0,
                  gamesLost: 0,
                };
                totals.setsWon += result.setsWon;
                totals.setsLost += result.setsLost;
                totals.gamesWon += result.gamesWon;
                totals.gamesLost += result.gamesLost;
                priorMetrics.set(result.playerId, totals);
              }
            }
            const seeded = [...priorPoints.keys()].sort((a, b) => {
              const pointsDelta = (priorPoints.get(b) ?? 0) - (priorPoints.get(a) ?? 0);
              if (pointsDelta) return pointsDelta;
              for (const metric of (previous?.ranking_priority ?? [
                'games_won',
                'sets_won',
                'games_difference',
              ]) as LadderMetric[]) {
                const value = (id: string) => {
                  const t = priorMetrics.get(id) ?? {
                    setsWon: 0,
                    setsLost: 0,
                    gamesWon: 0,
                    gamesLost: 0,
                  };
                  return metric === 'sets_won'
                    ? t.setsWon
                    : metric === 'games_won'
                      ? t.gamesWon
                      : metric === 'games_difference'
                        ? t.gamesWon - t.gamesLost
                        : t.setsWon - t.setsLost;
                };
                const delta = value(b) - value(a);
                if (delta) return delta;
              }
              return a.localeCompare(b);
            });
            if (seeded.length) {
              const { error: seedError } = await db.from('social_doubles_ladder_seeds').insert(
                seeded.map((userId, index) => ({
                  ladder_id: ladderId,
                  user_id: userId,
                  initial_position: index + 1,
                  initial_points:
                    v.ladder_carryover === 'full' ? (priorPoints.get(userId) ?? 0) : 0,
                })),
              );
              if (seedError) throw seedError;
            }
          }
        }
        const { error: linkError } = await db
          .from('events')
          .update({
            social_doubles_ladder_id: ladderId,
            ladder_gender: v.ladder_gender,
            ladder_position_points: v.ladder_points,
            ladder_ranking_priority: v.ladder_ranking_priority,
          })
          .in(
            'id',
            created.map((x) => x.id),
          );
        if (linkError) throw linkError;
      }
      if (v.is_league_tournament && created?.length) {
        let leagueId = v.league_existing_id;
        if (!leagueId) {
          const { data: league, error: leagueError } = await db
            .from('social_doubles_ladders')
            .insert({
              name: v.ladder_name.trim() || v.title.trim(),
              gender: v.ladder_gender,
              position_points: [0, 0, 0, 0],
              ranking_priority: v.tournament_config.ranking_priority ?? [
                'matches_won',
                'sets_won',
                'games_won',
              ],
              starts_at: starts.toISOString(),
              ends_at: rows[rows.length - 1]?.ends_at ?? ends.toISOString(),
              created_by: user.id,
              competition_type: 'league',
              season: String(starts.getFullYear()),
              tournament_config: leagueTournamentConfig(v.tournament_config, v.ladder_gender),
              tournament_rules_html: '',
            })
            .select('id')
            .single();
          if (leagueError) throw leagueError;
          leagueId = league.id;
        }
        const { error: sharedConfigError } = await db
          .from('social_doubles_ladders')
          .update({
            gender: v.ladder_gender,
            tournament_config: leagueTournamentConfig(v.tournament_config, v.ladder_gender),
            tournament_rules_html: '',
          })
          .eq('id', leagueId);
        if (sharedConfigError) throw sharedConfigError;
        const { error: linkError } = await db
          .from('events')
          .update({
            social_doubles_ladder_id: leagueId,
            gender_restriction: v.ladder_gender,
            tournament_format: 'doubles',
            tournament_config: leagueTournamentConfig(v.tournament_config, v.ladder_gender),
          })
          .in(
            'id',
            created.map((x) => x.id),
          );
        if (linkError) throw linkError;
      }
      dispatchEventNotificationsInBackground(
        (created ?? []).map((x) => x.id),
        'Event management',
      );
      setMessage(`${created?.length ?? rows.length} event${rows.length === 1 ? '' : 's'} created.`);
      router.push('/admin/events');
      router.refresh();
    } catch (err) {
      console.error('[Event management] Event save failed', err);
      setError(err instanceof Error ? err.message : 'Could not save event. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <FloatingFeedback error={error} message={message} />
      {v.id && v.series_id && (
        <section className="rounded-xl border border-border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyToSeries}
              onChange={(e) => setApplyToSeries(e.target.checked)}
              className="mt-1"
            />
            <span>
              <strong>Apply shared fields to all recurring events</strong>
              <span className="mt-1 block text-muted-foreground">
                Updates title, description, gender restriction, publication status, capacity, price,
                location, membership requirement, waitlist, and available courts. Dates,
                participants, and court assignments remain unchanged for other events.
              </span>
            </span>
          </label>
        </section>
      )}
      <EventBasicsFields
        v={v}
        change={change}
        showOrganizerField={showOrganizerField}
        currentUserId={currentUserId}
        organizerOptions={organizerOptions}
        onEventTypeChange={handleEventTypeChange}
      />
      <EventCompetitionFields
        v={v}
        change={change}
        recurring={recurring}
        availableLadders={availableLadders}
        ladderOptions={ladderOptions}
        generateRulesText={generateRulesText}
      />
      <EventSchedulingFields
        v={v}
        change={change}
        recurring={recurring}
        setRecurring={setRecurring}
        frequency={frequency}
        setFrequency={setFrequency}
        dayOfWeek={dayOfWeek}
        setDayOfWeek={setDayOfWeek}
        seriesStartDate={seriesStartDate}
        setSeriesStartDate={setSeriesStartDate}
        until={until}
        setUntil={setUntil}
        seriesStartTime={seriesStartTime}
        setSeriesStartTime={setSeriesStartTime}
        seriesEndTime={seriesEndTime}
        setSeriesEndTime={setSeriesEndTime}
        openDays={openDays}
        setOpenDays={setOpenDays}
        closeDays={closeDays}
        setCloseDays={setCloseDays}
        openTime={openTime}
        setOpenTime={setOpenTime}
        closeTime={closeTime}
        setCloseTime={setCloseTime}
        seedSeriesFromEvent={() =>
          seedEventSeriesFields(
            v,
            setSeriesStartDate,
            setDayOfWeek,
            setSeriesStartTime,
            setSeriesEndTime,
          )
        }
        firstSeriesDate={firstSeriesDate}
        previewRegistrationDate={(daysBefore) => previewRegistrationWeekday(daysBefore, dayOfWeek)}
      />

      <Button disabled={busy}>
        {busy ? (
          <TennisLoader compact label="Saving" />
        ) : v.id ? (
          'Save event changes'
        ) : recurring ? (
          'Create events'
        ) : v.is_league_tournament ? (
          'Create event'
        ) : v.event_type === 'tournament' ? (
          'Create tournament'
        ) : (
          'Create event'
        )}
      </Button>
    </form>
  );
}
