'use client';

import { OTPInput, OTPInputContext } from 'input-otp';
import { useContext, type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function InputOTP({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn('flex items-center has-disabled:opacity-50', containerClassName)}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-otp-group" className={cn('flex w-full gap-2.5', className)} {...props} />;
}

/** One digit box, in Alexandria as drawn in `s2`. The boxes shrink to fit a 360px phone. */
function InputOTPSlot({ index, className, ...props }: ComponentProps<'div'> & { index: number }) {
  const context = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = context?.slots[index] ?? {};

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        'relative flex h-16 min-w-0 flex-1 items-center justify-center rounded-field border-2 border-input bg-surface font-display text-digit text-text-primary transition-colors',
        'aria-invalid:border-error data-[active=true]:z-10 data-[active=true]:border-3 data-[active=true]:border-link',
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-0.5 bg-accent" />
        </div>
      )}
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot };
