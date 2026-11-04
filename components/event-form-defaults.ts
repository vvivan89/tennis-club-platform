import type { TournamentConfig } from '@/lib/tournament-config';
import type { EventFormValues } from '@/components/event-form-types';

export const localValue = (value?: string | null) =>
  value
    ? new Date(value)
        .toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
        .replace(' ', 'T')
        .slice(0, 16)
    : '';

export const leagueTournamentConfig = (
  config: EventFormValues['tournament_config'],
  ladderGender: string,
) => ({
  ...config,
  categories: [ladderGender === 'male' ? 'men' : 'women'],
  phases: { round_robin: true },
  group_count: 1,
  teams_per_group: 4,
  registration_mode: 'both' as const,
});

export function getEventTypeFormUpdate(value: string, current: EventFormValues) {
  const update: Partial<EventFormValues> = {
    is_league_tournament: value === 'league_tournament',
    event_type:
      value === 'social' || value === 'social_doubles_ladder' || value === 'party'
        ? value
        : 'tournament',
  };
  if (value === 'league_tournament') {
    Object.assign(update, {
      tournament_format: 'doubles',
      members_only: false,
      tournament_config: leagueTournamentConfig(current.tournament_config, current.ladder_gender),
    });
  } else if (value === 'social_doubles_ladder') {
    Object.assign(update, { gender_restriction: current.ladder_gender, members_only: true });
  } else if (value === 'party') {
    Object.assign(update, {
      gender_restriction: null,
      members_only: false,
      waitlist_enabled: false,
    });
  } else if (value !== 'social') {
    Object.assign(update, {
      members_only: false,
      tournament_format: value === 'team_tournament' ? 'team' : 'doubles',
      tournament_config: {
        ...current.tournament_config,
        ranking_priority:
          value === 'team_tournament'
            ? ['matches_won', 'sets_won', 'games_won']
            : (
                current.tournament_config.ranking_priority ?? [
                  'matches_won',
                  'sets_won',
                  'games_won',
                ]
              ).filter((key) => key !== 'points'),
      },
    });
  }
  return {
    update,
    recurring:
      value === 'league_tournament' || value === 'social_doubles_ladder'
        ? true
        : value === 'social'
          ? undefined
          : false,
    seedSeries: value === 'league_tournament' || value === 'social_doubles_ladder',
  };
}

export function previewRegistrationWeekday(daysBefore: string, dayOfWeek: string) {
  const desiredDay = Number(dayOfWeek);
  const days = Number(daysBefore);
  if (
    !Number.isInteger(desiredDay) ||
    desiredDay < 0 ||
    desiredDay > 6 ||
    !Number.isFinite(days) ||
    days < 0
  )
    return '';
  const date = new Date('2024-01-07T12:00:00');
  date.setDate(date.getDate() + desiredDay - Math.floor(days));
  return date.toLocaleDateString(undefined, { weekday: 'long' });
}

export function seedEventSeriesFields(
  values: Pick<EventFormValues, 'starts_at' | 'ends_at'>,
  setSeriesStartDate: (value: string) => void,
  setDayOfWeek: (value: string) => void,
  setSeriesStartTime: (value: string) => void,
  setSeriesEndTime: (value: string) => void,
) {
  if (values.starts_at) {
    setSeriesStartDate(values.starts_at.slice(0, 10));
    setDayOfWeek(String(new Date(values.starts_at).getDay()));
    setSeriesStartTime(values.starts_at.slice(11, 16));
  }
  if (values.ends_at) setSeriesEndTime(values.ends_at.slice(11, 16));
}

export function getFirstSeriesDate(seriesStartDate: string, dayOfWeek: string) {
  if (!seriesStartDate) return null;
  const date = new Date(`${seriesStartDate}T12:00:00`);
  const desiredDay = Number(dayOfWeek);
  date.setDate(date.getDate() + ((desiredDay - date.getDay() + 7) % 7));
  return date;
}

export const initialEventFormValues: EventFormValues = {
  title: '',
  description: '',
  gender_restriction: null,
  event_type: 'social',
  starts_at: '',
  ends_at: '',
  registration_opens_at: '',
  registration_closes_at: '',
  capacity: 16,
  price_cents: 0,
  allow_plus_one: false,
  guest_price_cents: 0,
  members_only: true,
  status: 'published',
  location: 'Port Coquitlam Tennis Club',
  notes: '',
  waitlist_enabled: true,
  court_count: 4,
  tournament_format: 'doubles',
  tournament_config: {
    categories: ['mixed', 'men', 'women'],
    phases: {
      round_robin: true,
      preliminary_knockout: false,
      final_knockout: true,
      team_round_robin: true,
      team_knockout: true,
    },
    group_count: 2,
    teams_per_group: 4,
    registration_mode: 'both',
    ranking_priority: ['matches_won', 'sets_won', 'games_won'],
    schedule: { match_minutes: 60, break_minutes: 15 },
    scoring_template: 'best_of_three',
  },
  tournament_rules_html: '',
  allow_non_member_registration: false,
  tournament_details_public: true,
  ladder_gender: 'male',
  ladder_points: [2, 1, -1, -2],
  ladder_ranking_priority: ['games_won', 'sets_won', 'games_difference'],
  ladder_carryover: 'none',
  ladder_previous_id: '',
  ladder_existing_id: '',
  ladder_name: '',
  league_existing_id: '',
  is_league_tournament: false,
};

export function generateRulesText(v: EventFormValues): string {
  const format = v.tournament_format === 'team' ? 'Team tournament' : 'Doubles tournament';
  const categoryNames = (v.tournament_config.categories ?? []).map((category) =>
    category === 'men'
      ? "men's doubles"
      : category === 'women'
        ? "women's doubles"
        : 'mixed doubles',
  );
  const phases = v.tournament_config.phases ?? {};
  const scoringTemplates: Record<string, string> = {
    one_set: 'one set',
    two_sets_then_third: 'best of three sets',
    best_of_three: 'best of three sets',
    team_two_sets_bonus_third:
      'two sets; a 2–0 win earns 3 team points; if split 1–1, play a third set for 2 points to the winner and 1 to the loser',
  };
  const scoringLabel = (template?: string) =>
    scoringTemplates[template ?? v.tournament_config.scoring_template ?? 'best_of_three'] ??
    'best of three sets';
  const phaseScoring = [
    [phases.round_robin, 'Round robin', 'round_robin'],
    [phases.preliminary_knockout, 'Preliminary knockout', 'preliminary_knockout'],
    [phases.final_knockout, 'Final knockout', 'final_knockout'],
    [phases.team_round_robin, 'Team round robin', 'team_round_robin'],
    [phases.team_knockout, 'Team knockout', 'team_knockout'],
  ]
    .filter(([enabled]) => enabled)
    .map(
      ([, label, key]) =>
        `${label}: ${scoringLabel(v.tournament_config.scoring_templates?.[key as keyof NonNullable<TournamentConfig['scoring_templates']>])}`,
    );
  const scoring = phaseScoring.length ? phaseScoring.join('; ') : scoringLabel();
  const registration =
    v.tournament_config.registration_mode === 'single'
      ? 'Players register individually and the organizer assigns partners.'
      : v.tournament_config.registration_mode === 'doubles'
        ? 'Players register with a partner.'
        : 'Players may register individually for organizer-assigned pairing or register with a partner.';
  const eligibility = v.allow_non_member_registration
    ? 'Eligible members and non-members may register; non-member accounts are not created.'
    : 'Registration is limited to eligible club members; non-member registration is not enabled.';
  const dates = `${v.starts_at ? new Date(v.starts_at).toLocaleString() : ''}${v.ends_at ? `${v.starts_at ? ' – ' : ''}${new Date(v.ends_at).toLocaleString()}` : ''}`;
  const phaseNames = [
    phases.round_robin || phases.team_round_robin ? 'round robin' : '',
    phases.preliminary_knockout ? 'preliminary single-elimination knockout' : '',
    phases.final_knockout || phases.team_knockout ? 'final single-elimination knockout' : '',
  ]
    .filter(Boolean)
    .join(', ');
  const promotionEnabled =
    v.tournament_format === 'team'
      ? phases.team_round_robin && phases.team_knockout
      : phases.round_robin && phases.final_knockout;
  return [
    `<h2>${format}</h2>`,
    dates ? `<p>Dates: ${dates}.</p>` : '',
    Number.isFinite(v.price_cents)
      ? `<p>Cost: ${v.price_cents === 0 ? 'Free' : `$${(v.price_cents / 100).toFixed(2)} CAD per participant`}.</p>`
      : '',
    `<p>Registration: ${registration}</p>`,
    `<p>Who can register: ${eligibility}</p>`,
    categoryNames.length ? `<p>Eligible categories: ${categoryNames.join(', ')}.</p>` : '',
    `<p>Scoring: ${scoring}.</p>`,
    phaseNames ? `<p>Competition phases: ${phaseNames}.</p>` : '',
    promotionEnabled
      ? `<p>Knockout qualification: the top ${Math.max(1, Number(v.tournament_config.promoted_teams_per_group ?? 2))} teams from each group advance.</p>`
      : '',
    v.registration_closes_at
      ? `<p>Registration closes: ${new Date(v.registration_closes_at).toLocaleString()}.</p>`
      : '',
  ]
    .filter(Boolean)
    .join('');
}
