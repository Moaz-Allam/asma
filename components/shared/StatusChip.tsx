import { cn } from '@/lib/utils';

/**
 * One status pill for every state machine (ui-registry `StatusChip`, ui-tokens §4). Colours come only from
 * the tone, and the label always says the state, so a state is never colour alone.
 */
export type ChipTone = 'waiting' | 'negative' | 'neutral' | 'info';

const TONES: Readonly<Record<ChipTone, string>> = {
  waiting: 'bg-warning-light text-warning-foreground',
  negative: 'bg-error-light text-error-foreground',
  neutral: 'bg-surface-secondary text-text-primary',
  info: 'bg-accent-light text-text-primary',
};

export function StatusChip({
  tone,
  label,
  className,
}: {
  tone: ChipTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-chip whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
