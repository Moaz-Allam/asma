import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The status timeline of a request (ui-registry `RequestTimeline`, spec 0010 AC-10): the steps that happened,
 * each with its time, and the next one greyed, connected by a vertical track. Built from stored columns only.
 */
export function RequestTimeline({
  title,
  steps,
}: {
  title: string;
  steps: readonly { key: string; label: string; at: string | null; done?: boolean }[];
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-panel border-2 border-border bg-surface p-5.5 lg:p-6.5"
    >
      <h2 className="font-display text-subhead text-text-primary">{title}</h2>
      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const done = step.done ?? step.at !== null;
          const last = index === steps.length - 1;
          return (
            <li key={step.key} className="flex items-stretch gap-3.5">
              <div className="flex flex-col items-center">
                {done ? (
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
                  >
                    <Check className="size-3.5" />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-control bg-surface"
                  />
                )}
                {last ? null : (
                  <span
                    aria-hidden
                    className={cn('my-1 w-0.5 flex-1', done ? 'bg-accent-light' : 'bg-border')}
                  />
                )}
              </div>
              <div className={cn('flex flex-col gap-0.5', last ? 'pb-0' : 'pb-4')}>
                <span
                  className={cn(
                    'text-body-s',
                    done ? 'font-bold text-text-primary' : 'font-medium text-text-secondary',
                  )}
                >
                  {step.label}
                </span>
                {step.at ? <span className="text-meta text-text-secondary">{step.at}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
