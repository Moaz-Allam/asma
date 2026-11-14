'use client';

import { cn } from '@/lib/utils';

/**
 * A single choice as a row of pills (ui-registry `ChoiceChips`): a real radio group, so arrows and Space
 * work by keyboard, and each pill is at least 44px tall.
 */
export function ChoiceChips<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-body-s font-bold text-text-primary">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center rounded-full px-5 py-3 text-btn-sm transition',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                checked ? 'bg-accent text-accent-foreground' : 'bg-surface-secondary text-text-primary',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
