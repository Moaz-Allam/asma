/** The page title with its one line explanation (ui-rules.md §13, §16). */
export function PageHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <header className="flex flex-col gap-4">
      <h1 className="font-display text-title text-text-primary">{title}</h1>
      {intro ? <p className="max-w-60ch text-body text-text-lede">{intro}</p> : null}
    </header>
  );
}
