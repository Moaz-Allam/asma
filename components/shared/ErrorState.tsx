import type { ReactNode } from 'react';

/**
 * A plain error, what stayed safe, and the next step (ui-registry `ErrorState`, `p17`, `a4`). The same
 * shape as `EmptyState`, announced as an alert.
 */
export function ErrorState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card bg-error-light px-6.5 py-12 text-center"
    >
      <h2 className="font-display text-card text-text-primary">{title}</h2>
      <p className="text-body-s text-text-secondary">{body}</p>
      {action}
    </section>
  );
}
