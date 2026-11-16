'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A wide row that switches one thing on or off (ui-registry `ToggleRow`, `s4` addons): the label at the
 * start, a value such as a price at the end. A real checkbox, so Space works and the state is announced;
 * the mark is a filled circle and a tick, never colour alone.
 */
export function ToggleRow({
  id,
  label,
  end,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  end?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-14 cursor-pointer items-center gap-3 rounded-field px-5 py-3 transition',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        checked ? 'bg-accent-light' : 'bg-surface-secondary',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full border-2',
          checked ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-surface',
        )}
      >
        {checked ? '✓' : null}
      </span>
      <span className="flex-1 text-body font-semibold text-text-primary">{label}</span>
      {end ? <span className="text-body-s font-bold text-text-primary">{end}</span> : null}
    </label>
  );
}
