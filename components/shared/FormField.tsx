import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';

/**
 * Label above, the control, a note, and the field's own error under it (ui-registry `FormField`, `p2`).
 * The error is linked to the control through `aria-describedby` by the caller (`${id}-error`).
 */
export function FormField({
  id,
  label,
  note,
  error,
  children,
}: {
  id: string;
  label: string;
  note?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {note ? <div className="text-meta font-normal text-text-secondary">{note}</div> : null}
      {error ? (
        <p id={`${id}-error`} className="text-meta text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
