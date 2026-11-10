'use client';

import { PlusIcon } from 'lucide-react';
import { Accordion as AccordionPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Accordion(props: ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        'overflow-hidden rounded-card border-2 border-border bg-surface',
        'data-[state=open]:border-surface-secondary data-[state=open]:bg-surface-secondary',
        className,
      )}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'group flex flex-1 items-center gap-4 px-5 py-5 text-start text-question text-text-primary lg:px-6.5 lg:py-6',
          'disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
        {...props}
      >
        <span className="flex-1">{children}</span>
        <span className="flex size-9.5 shrink-0 items-center justify-center rounded-full bg-surface-secondary transition-transform duration-200 group-data-[state=open]:rotate-45 group-data-[state=open]:bg-accent-muted">
          <PlusIcon aria-hidden className="size-5" strokeWidth={2.5} />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    // forceMount keeps a closed answer in the server HTML, for search (spec 0005 AC-29); CSS hides it.
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      forceMount
      className="overflow-hidden text-answer text-text-body data-[state=closed]:hidden"
      {...props}
    >
      <div className={cn('max-w-88ch px-5 pb-5 lg:px-6.5 lg:pb-6.5', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
