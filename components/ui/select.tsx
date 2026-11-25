import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** A 61px native select matching `Input` height, border, and radius (ui-rules.md §19). */
function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-15.25 w-full min-w-0 rounded-field border-2 border-input bg-surface px-4.5 text-body text-text-primary transition-colors',
        'focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-error',
        className,
      )}
      {...props}
    />
  );
}

export { Select };
