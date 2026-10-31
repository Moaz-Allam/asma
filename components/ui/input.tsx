import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** A 61px field (ui-rules.md §19). The label is always visible, above it. */
function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-15.25 w-full min-w-0 rounded-field border-2 border-input bg-surface px-4.5 py-3.5 text-body text-text-primary transition-colors',
        'placeholder:text-text-secondary focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-surface-secondary',
        'aria-invalid:border-error',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
