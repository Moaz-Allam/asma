'use client';

import { XIcon } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({ className, ...props }: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('fixed inset-0 z-30 bg-surface-inverse/50', className)}
      {...props}
    />
  );
}

/** `start` and `end` follow the direction of the page. `closeLabel` is required: no string lives here. */
function SheetContent({
  className,
  children,
  side = 'end',
  closeLabel,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'start' | 'end' | 'bottom';
  closeLabel: string;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed z-40 flex flex-col gap-4 bg-surface shadow-overlay',
          side === 'end' && 'inset-y-0 end-0 h-full w-3/4 border-s-2 border-border sm:max-w-sm',
          side === 'start' && 'inset-y-0 start-0 h-full w-3/4 border-e-2 border-border sm:max-w-sm',
          side === 'bottom' && 'inset-x-0 bottom-0 h-auto rounded-t-panel border-t-2 border-border',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute end-4 top-4 rounded-xs text-text-secondary hover:text-text-primary">
          <XIcon className="size-5" />
          <span className="sr-only">{closeLabel}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-5', className)} {...props} />;
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-2 p-5', className)} {...props} />
  );
}

function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-display text-card text-text-primary', className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-body-s text-text-secondary', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
