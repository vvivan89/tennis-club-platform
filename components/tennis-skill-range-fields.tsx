import { getTennisSkillLevels } from '@/lib/tennis-skill-levels';

const SKILL_LEVELS = getTennisSkillLevels();

export function TennisSkillRangeFields({
  minimum,
  maximum,
  onMinimumChange,
  onMaximumChange,
}: {
  minimum: string;
  maximum: string;
  onMinimumChange: (value: string) => void;
  onMaximumChange: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Tennis skill restrictions</legend>
      <p className="text-xs text-muted-foreground">
        Players must have a profile rating within the selected range. Leave both unrestricted to
        allow any rating.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          Minimum skill level
          <select
            aria-label="Minimum skill level"
            value={minimum}
            onChange={(event) => onMinimumChange(event.target.value)}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="">No minimum</option>
            {SKILL_LEVELS.filter((level) => !maximum || Number(level) <= Number(maximum)).map(
              (level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          Maximum skill level
          <select
            aria-label="Maximum skill level"
            value={maximum}
            onChange={(event) => onMaximumChange(event.target.value)}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="">No maximum</option>
            {SKILL_LEVELS.filter((level) => !minimum || Number(level) >= Number(minimum)).map(
              (level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
