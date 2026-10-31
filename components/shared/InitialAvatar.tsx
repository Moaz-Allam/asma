import { firstGrapheme } from '@/lib/account/initial';
import { cn } from '@/lib/utils';

/** A person without a photo: the first letter of their name on a disc (`s6`, `s7`, `s9`). */
export function InitialAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-light font-display text-group text-text-primary',
        className,
      )}
    >
      {firstGrapheme(name)}
    </span>
  );
}
