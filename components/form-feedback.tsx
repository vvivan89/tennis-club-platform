export function FormFeedback({
  error,
  message,
  className = '',
}: {
  error?: string | null;
  message?: string | null;
  className?: string;
}) {
  return (
    <>
      {error && (
        <p role="alert" className={`${className} text-sm text-destructive`.trim()}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={`${className} text-sm`.trim()}>
          {message}
        </p>
      )}
    </>
  );
}
