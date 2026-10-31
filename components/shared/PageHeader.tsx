/** The page title with its one line explanation (ui-rules.md §13, §16). */
export function PageHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-display text-title text-text-primary">{title}</h1>
      {intro ? <p className="text-body text-text-secondary">{intro}</p> : null}
    </header>
  );
}
