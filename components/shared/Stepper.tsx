import { Check } from 'lucide-react';

import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Flow progress (ui-registry `Stepper`, `p2`, `p3`): the current step is a navy pill, a done step carries a
 * tick, the separator mirrors with the direction. A step with an `href` is a link back.
 */
export function Stepper({
  label,
  steps,
}: {
  label: string;
  steps: ReadonlyArray<{ label: string; state: 'done' | 'current' | 'next'; href?: string }>;
}) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-2 text-body-s font-semibold">
        {steps.map((step, index) => {
          const content = (
            <>
              {index + 1} {step.label}
              {step.state === 'done' ? <Check aria-hidden className="size-4" /> : null}
            </>
          );
          const pill = cn(
            'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2',
            step.state === 'current' && 'bg-accent text-accent-foreground',
            step.state === 'done' && 'bg-surface-secondary text-text-primary',
            step.state === 'next' && 'text-text-secondary',
          );
          return (
            <li key={step.label} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden className="text-text-secondary rtl:-scale-x-100">
                  ›
                </span>
              ) : null}
              {step.href && step.state !== 'current' ? (
                <Link href={step.href} className={pill}>
                  {content}
                </Link>
              ) : (
                <span className={pill} aria-current={step.state === 'current' ? 'step' : undefined}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
