type GenderSelectProps = {
  value: string;
  onChange: (value: string) => void;
};

export function GenderSelect({ value, onChange }: GenderSelectProps) {
  return (
    <label className="text-sm">
      Gender
      <select
        className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Not specified</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
    </label>
  );
}
