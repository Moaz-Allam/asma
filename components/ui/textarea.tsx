import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** A multi line field, the same border and radius as `Input` (ui-rules.md §19, `p2` bio). */
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 rounded-field border-2 border-input bg-surface px-4.5 py-4 text-body text-text-primary transition-colors',
        'placeholder:text-text-secondary focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-surface-secondary',
        'aria-invalid:border-error',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
