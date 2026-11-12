type GenderSelectProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  label?: string;
  className?: string;
  selectClassName?: string;
};

export function GenderSelect({
  value,
  defaultValue,
  onChange,
  name,
  label = 'Gender (for doubles events)',
  className = 'text-sm',
  selectClassName = 'mt-1 block h-10 w-full rounded-md border border-input bg-background px-3',
}: GenderSelectProps) {
  return (
    <label className={className}>
      {label} <span className="text-destructive">*</span>
      <select
        name={name}
        className={selectClassName}
        value={value}
        defaultValue={value === undefined ? (defaultValue ?? '') : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        required
      >
        <option value="" disabled>
          Select gender
        </option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
    </label>
  );
}
