'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Several choices as pills (`p2` languages): real checkboxes, so each toggles by keyboard, and a tick
 * marks the chosen ones so the state is never colour alone.
 */
export function ToggleChips<T extends string>({
  name,
  legend,
  options,
  values,
  onChange,
  invalid,
  disabled,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  values: readonly T[];
  onChange: (values: T[]) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} aria-invalid={invalid || undefined}>
      <legend className="mb-2 text-body-s font-bold text-text-primary">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-5 py-3 text-btn-sm transition',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                checked ? 'bg-accent text-accent-foreground' : 'bg-surface-secondary text-text-primary',
                invalid && !checked && 'ring-2 ring-error',
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() =>
                  onChange(checked ? values.filter((v) => v !== option.value) : [...values, option.value])
                }
                className="sr-only"
              />
              {checked ? <Check aria-hidden className="size-4" /> : null}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
