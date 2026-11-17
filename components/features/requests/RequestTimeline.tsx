import { Check, Circle } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The status timeline of a request (ui-registry `RequestTimeline`, spec 0010 AC-10): the steps that happened,
 * each with its time, and the next one greyed. Built from stored columns only; 09 to 11 add their steps.
 * Display only; the page passes the labels and the formatted times.
 */
export function RequestTimeline({
  title,
  steps,
}: {
  title: string;
  steps: readonly { key: string; label: string; at: string | null }[];
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-panel border border-border-light bg-surface p-5"
    >
      <h2 className="text-body-s font-bold text-text-primary">{title}</h2>
      <ol className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3">
            {step.at ? (
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-text-secondary" />
            )}
            <div className="flex flex-col">
              <span
                className={cn(
                  'text-body-s font-semibold',
                  step.at ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {step.label}
              </span>
              {step.at ? <span className="text-meta text-text-secondary">{step.at}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
