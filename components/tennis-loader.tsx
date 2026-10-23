export function TennisLoader({
  label = 'Loading',
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  const Wrapper = compact ? 'span' : 'div';
  return (
    <Wrapper
      role="status"
      aria-live="polite"
      className={`tennis-loader ${compact ? 'tennis-loader-compact' : ''}`}
    >
      <span className="tennis-loader-track" aria-hidden="true">
        <span className="tennis-loader-ball" />
      </span>
      <span>
        {label}
        <span className="tennis-loader-dots" aria-hidden="true">
          ...
        </span>
      </span>
    </Wrapper>
  );
}
