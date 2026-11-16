import { TennisSkillRangeFields } from '@/components/tennis-skill-range-fields';
import type { EventFormValues } from '@/components/event-form-types';

export function EventSkillRestrictions({
  values,
  change,
}: {
  values: EventFormValues;
  change: <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => void;
}) {
  const visible =
    values.is_league_tournament ||
    values.event_type === 'social_doubles_ladder' ||
    (values.event_type === 'tournament' &&
      ['doubles', 'singles'].includes(values.tournament_format ?? ''));
  if (!visible) return null;
  return (
    <TennisSkillRangeFields
      minimum={values.minimum_tennis_skill_level}
      maximum={values.maximum_tennis_skill_level}
      onMinimumChange={(value) => change('minimum_tennis_skill_level', value)}
      onMaximumChange={(value) => change('maximum_tennis_skill_level', value)}
    />
  );
}
