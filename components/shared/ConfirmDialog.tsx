'use client';

import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Asks before an action with a consequence (ui-registry `ConfirmDialog`, `a2`): states what will happen,
 * one confirm, one cancel. Focus is trapped and Escape cancels. `children` holds a field when the action
 * needs one (the suspension reason).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-surface-inverse/40" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto flex max-w-md -translate-y-1/2 flex-col gap-4 rounded-panel bg-surface p-6.5 shadow-overlay">
          <Dialog.Title className="font-display text-title-s text-text-primary">{title}</Dialog.Title>
          <Dialog.Description className="text-body-s text-text-secondary">{body}</Dialog.Description>
          {children}
          <div className="flex flex-wrap gap-2.5">
            <Button size="lg" className="flex-1" onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
            <Dialog.Close asChild>
              <Button size="lg" variant="secondary" disabled={busy}>
                {cancelLabel}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
