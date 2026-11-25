import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** Every button is a pill (ui-rules.md §18). One primary per view; a money action opens a dialog first. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full transition duration-150 ease-out hover:-translate-y-px active:translate-y-0 active:scale-98 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-foreground hover:bg-link',
        secondary: 'bg-surface-secondary text-text-primary hover:bg-accent-muted',
        white: 'bg-surface text-text-primary hover:bg-surface-secondary',
        destructive: 'bg-surface text-error hover:bg-error-light',
        outline: 'border-2 border-accent bg-surface text-text-primary hover:bg-surface-secondary',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        sm: 'px-4.5 py-2.5 text-btn-sm',
        md: 'px-5.5 py-3 text-btn-sm',
        lg: 'px-6.5 py-4 text-btn',
        nav: 'px-5.5 py-3 text-btn-nav',
        band: 'px-7.5 py-4.75 text-btn-band',
        hero: 'px-7.5 py-5 text-btn-lg',
        block: 'w-full px-6.5 py-4.5 text-btn-band',
        text: 'text-btn-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
