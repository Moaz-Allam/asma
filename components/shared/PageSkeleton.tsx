/**
 * The loading state of a private page (ui-rules.md §22): the shape of a title and two panels, quiet, with
 * no spinner. Announced once to a screen reader.
 */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex animate-pulse flex-col gap-5">
      <div className="h-10 w-2/3 max-w-md rounded-row bg-surface-secondary" />
      <div className="grid gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="h-64 rounded-panel bg-surface-secondary" />
        <div className="h-40 rounded-panel bg-surface-secondary" />
      </div>
    </div>
  );
}
