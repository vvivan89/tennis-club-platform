type NavCountBadgeProps = {
  count: number;
  label: string;
};

export function NavCountBadge({ count, label }: NavCountBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      aria-label={label}
      className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
