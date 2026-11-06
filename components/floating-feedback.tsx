export function FloatingFeedback({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
    >
      {error && (
        <p
          role="alert"
          className="pointer-events-auto rounded-md border border-destructive/30 bg-background p-3 text-sm text-destructive shadow-lg"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="pointer-events-auto rounded-md border border-success/30 bg-background p-3 text-sm shadow-lg"
        >
          {message}
        </p>
      )}
    </div>
  );
}
