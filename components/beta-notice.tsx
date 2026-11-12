export function BetaNotice() {
  return (
    <aside
      aria-label="Beta notice"
      className="border-b border-border bg-secondary px-4 py-2 text-center text-sm text-secondary-foreground"
    >
      <span className="font-semibold">Beta</span> — This app is currently in beta mode. Please
      report any errors and bugs to club administrators.
    </aside>
  );
}
