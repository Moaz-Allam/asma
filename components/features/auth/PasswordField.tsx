'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A password field with a show and hide button (spec 0012 AC-1, AC-5). Typed text stays left to right only when it
 * is Latin: `dir="auto"` lets an Arabic password read naturally. The value is never trimmed here or anywhere else.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  showLabel,
  hideLabel,
  error,
  describedBy,
  hint,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  showLabel: string;
  hideLabel: string;
  error: boolean;
  /** The id of the error or rules text this field answers to. */
  describedBy?: string;
  hint?: string;
  onChange?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const described = [hintId, error ? describedBy : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="auto"
          aria-invalid={error}
          aria-describedby={described}
          className="pe-13"
          onChange={onChange}
        />
        <button
          type="button"
          aria-label={shown ? hideLabel : showLabel}
          aria-pressed={shown}
          aria-controls={id}
          className="absolute end-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-text-secondary hover:text-text-primary"
          onClick={() => setShown((value) => !value)}
        >
          {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-meta font-normal text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
