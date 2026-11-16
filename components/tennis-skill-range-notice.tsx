import { formatTennisSkillRange } from '@/lib/tennis-skill-range';

export function TennisSkillRangeNotice({
  minimum,
  maximum,
}: {
  minimum?: number | null;
  maximum?: number | null;
}) {
  const range = formatTennisSkillRange({ minimum: minimum ?? null, maximum: maximum ?? null });
  if (!range) return null;
  return (
    <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      Tennis skill range: <span className="font-medium">{range}</span>
    </p>
  );
}
