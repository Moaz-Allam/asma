'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** The phone field with the region's prefix (`s2`). Numbers stay left to right inside RTL text (rule 10). */
export function PhoneField({
  id,
  label,
  placeholder,
  dialCode,
  error,
  errorId,
  autoComplete = 'tel-national',
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  dialCode: string;
  error: boolean;
  errorId: string;
  /**
   * Spec 0012 AC-1: `username` beside a password, so password managers pair the two. Not `username tel`: the HTML
   * autofill grammar takes one field name, and axe fails two (WCAG 1.3.5). `type="tel"` keeps the number keypad.
   */
  autoComplete?: string;
  onChange: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div dir="ltr" className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute start-4.5 top-1/2 -translate-y-1/2 text-body text-text-secondary"
        >
          {dialCode}
        </span>
        <Input
          id={id}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          dir="ltr"
          placeholder={placeholder}
          aria-invalid={error}
          aria-describedby={error ? errorId : undefined}
          className="ps-15"
          onChange={onChange}
        />
      </div>
    </div>
  );
}
