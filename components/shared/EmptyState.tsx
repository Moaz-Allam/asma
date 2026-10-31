import type { ReactNode } from 'react';

/** A big lead, what will appear here, and the next step (`s17`, `p17`, `a4`; ui-rules.md §22). */
export function EmptyState({
  lead,
  title,
  body,
  action,
}: {
  lead: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-card bg-surface-secondary px-6.5 py-12 text-center">
      <p aria-hidden className="font-display text-title text-text-primary">
        {lead}
      </p>
      <h2 className="font-display text-card text-text-primary">{title}</h2>
      <p className="text-body-s text-text-secondary">{body}</p>
      {action}
    </section>
  );
}
