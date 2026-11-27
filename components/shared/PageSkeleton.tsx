/**
 * The loading state of a private page (ui-rules.md §4, §22): layout-matching shapes (`split`, `list`, or
 * `dashboard`), quiet, with no spinner. Announced once to a screen reader.
 */
export function PageSkeleton({
  label,
  variant = 'split',
}: {
  label: string;
  variant?: 'split' | 'list' | 'dashboard';
}) {
  return (
    <div role="status" aria-label={label} className="flex animate-pulse flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <div className="h-10 w-2/3 max-w-md rounded-row bg-surface-secondary" />
        <div className="h-4 w-1/2 max-w-xs rounded-xs bg-surface-secondary" />
      </div>
      {variant === 'dashboard' ? (
        <>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="h-32 rounded-panel bg-accent-light/60" />
            <div className="h-32 rounded-panel bg-surface-secondary" />
            <div className="h-32 rounded-panel bg-surface-secondary" />
            <div className="h-32 rounded-panel bg-surface-secondary" />
          </div>
          <div className="grid gap-3.5 lg:grid-cols-[1.5fr_1fr]">
            <div className="h-72 rounded-panel bg-surface-secondary" />
            <div className="h-60 rounded-panel bg-surface-secondary" />
          </div>
        </>
      ) : variant === 'list' ? (
        <>
          <div className="flex gap-2">
            <div className="h-11 w-24 rounded-full bg-surface-secondary" />
            <div className="h-11 w-24 rounded-full bg-surface-secondary" />
            <div className="h-11 w-24 rounded-full bg-surface-secondary" />
          </div>
          <div className="flex flex-col gap-3.5">
            <div className="h-32 rounded-panel border-2 border-border bg-surface-secondary/50" />
            <div className="h-32 rounded-panel border-2 border-border bg-surface-secondary/50" />
            <div className="h-32 rounded-panel border-2 border-border bg-surface-secondary/50" />
          </div>
        </>
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-[1.5fr_1fr]">
          <div className="h-64 rounded-panel bg-surface-secondary" />
          <div className="h-44 rounded-panel bg-accent-light/50" />
        </div>
      )}
    </div>
  );
}
