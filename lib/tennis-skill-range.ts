export type TennisSkillRange = {
  minimum: number | null;
  maximum: number | null;
};

export function tennisSkillInputValue(value: number | string | null | undefined): string {
  return value == null || value === '' ? '' : Number(value).toFixed(1);
}

export function formatTennisSkillRange({ minimum, maximum }: TennisSkillRange): string | null {
  if (minimum == null && maximum == null) return null;
  if (minimum != null && maximum != null) return `${minimum.toFixed(1)}–${maximum.toFixed(1)}`;
  if (minimum != null) return `${minimum.toFixed(1)} and above`;
  return `up to ${maximum!.toFixed(1)}`;
}

export function isTennisSkillInRange(
  skill: number | string | null | undefined,
  { minimum, maximum }: TennisSkillRange,
) {
  if (minimum == null && maximum == null) return true;
  const value = typeof skill === 'string' ? Number(skill) : skill;
  return (
    value != null &&
    Number.isFinite(value) &&
    (minimum == null || value >= minimum) &&
    (maximum == null || value <= maximum)
  );
}

export function getTennisSkillRestrictionError(
  skill: number | string | null | undefined,
  range: TennisSkillRange,
  playerLabel = 'Your',
) {
  if (range.minimum == null && range.maximum == null) return null;
  const value = typeof skill === 'string' ? Number(skill) : skill;
  if (value == null || !Number.isFinite(value))
    return `${playerLabel} tennis skill rating is required for this event.`;
  if (!isTennisSkillInRange(value, range)) {
    const rangeText = formatTennisSkillRange(range);
    return `${playerLabel} tennis skill rating must be ${rangeText} to register.`;
  }
  return null;
}
