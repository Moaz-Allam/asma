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
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  dialCode: string;
  error: boolean;
  errorId: string;
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
          autoComplete="tel-national"
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
