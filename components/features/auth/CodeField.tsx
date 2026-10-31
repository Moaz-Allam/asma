'use client';

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { CODE_LENGTH } from '@/lib/auth/limits';
import { foldDigits } from '@/lib/region/phone';

/** Western and both Arabic digit sets, so a phone keyboard in Arabic works. Folded before use. */
const DIGITS = '^[0-9\\u0660-\\u0669\\u06F0-\\u06F9]*$';

/** Six boxes (D55): typing, paste and phone autofill, submitting at the sixth digit (AC-6). */
export function CodeField({
  label,
  value,
  invalid,
  disabled,
  onChange,
  onComplete,
}: {
  label: string;
  value: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onComplete: (code: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="login-code">{label}</Label>
      <div dir="ltr">
        <InputOTP
          id="login-code"
          maxLength={CODE_LENGTH}
          pattern={DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          disabled={disabled}
          value={value}
          aria-invalid={invalid}
          pasteTransformer={(text) => foldDigits(text).replace(/\D/g, '')}
          onChange={(next) => onChange(foldDigits(next))}
          onComplete={onComplete}
        >
          <InputOTPGroup>
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <InputOTPSlot key={index} index={index} aria-invalid={invalid} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
    </div>
  );
}
