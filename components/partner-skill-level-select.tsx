export function PartnerSkillLevelSelect({
  value,
  onChange,
  className = 'text-sm',
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={className}>
      Partner tennis skill level (optional)
      <select
        className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Not specified</option>
        {Array.from({ length: 10 }, (_, index) => (2.5 + index * 0.5).toFixed(1)).map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </label>
  );
}
