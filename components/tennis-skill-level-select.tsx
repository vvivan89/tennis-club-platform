import { ExternalLink } from 'lucide-react';
import { useId } from 'react';
import { getTennisSkillLevels } from '@/lib/tennis-skill-levels';

type TennisSkillLevelSelectProps = {
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  minSkill?: number;
  maxSkill?: number;
  emptyOptionLabel?: string;
  placeholder?: string;
  className?: string;
  selectClassName?: string;
};

export function TennisSkillLevelSelect({
  label,
  value,
  defaultValue,
  onChange,
  name,
  minSkill = 2.5,
  maxSkill = 7.0,
  emptyOptionLabel,
  placeholder = 'Select your rating',
  className = 'block space-y-1.5 text-sm font-medium',
  selectClassName = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
}: TennisSkillLevelSelectProps) {
  const levels = getTennisSkillLevels(minSkill, maxSkill);
  const selectId = useId();

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={selectId}>
          {label} <span className="text-destructive">*</span>
        </label>
        <a
          href="https://assets.tenniscanada.com/production/PDFs/Self-Rating-Guide-English.pdf"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Self-assesment guide
          <ExternalLink aria-hidden="true" size={13} />
        </a>
      </div>
      <select
        id={selectId}
        name={name}
        className={selectClassName}
        value={value}
        defaultValue={value === undefined ? (defaultValue ?? '') : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        required
      >
        <option value="" disabled>
          {emptyOptionLabel ?? placeholder}
        </option>
        {levels.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </div>
  );
}
