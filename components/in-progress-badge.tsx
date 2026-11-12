export function InProgressBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ${className}`}
    >
      In progress
    </span>
  );
}
