'use client';

import { RATING_SCORES, type RatingScore } from '@/lib/ratings/summary';
import { cn } from '@/lib/utils';

/**
 * One dimension's five stars (ui-registry `RatingStars`, s9, spec 0011-17 AC-6): a native radio group, so arrow keys
 * move between the stars and the legend names the dimension. Five 44px circles, `bg-accent-muted` with a star, lit
 * `bg-accent` up to the pick. Each star's name is "4 of 5" from the caller.
 */
export function RatingStars({
  name,
  legend,
  value,
  onChange,
  starLabel,
  disabled = false,
}: {
  name: string;
  legend: string;
  value: RatingScore | null;
  onChange: (score: RatingScore) => void;
  starLabel: (score: RatingScore) => string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5" disabled={disabled}>
      <legend className="mb-2.5 text-body-s font-bold text-text-primary">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {RATING_SCORES.map((score) => {
          const lit = value !== null && score <= value;
          return (
            <label key={score} className="relative cursor-pointer has-disabled:cursor-default">
              <input
                type="radio"
                name={name}
                value={score}
                checked={value === score}
                onChange={() => onChange(score)}
                className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
              />
              <span
                aria-hidden
                className={cn(
                  'flex size-11 items-center justify-center rounded-full text-title-s transition-colors',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                  lit ? 'bg-accent text-accent-foreground' : 'bg-accent-muted text-accent',
                )}
              >
                ★
              </span>
              <span className="sr-only">{starLabel(score)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One rating's scores, read only: small lit circles, the score named for screen readers. */
export function RatingScoresRow({ label, score, name }: { label: string; score: number; name: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-body-s text-text-primary">{label}</span>
      <span role="img" aria-label={name} className="flex gap-1">
        {RATING_SCORES.map((n) => (
          <span
            key={n}
            aria-hidden
            className={cn(
              'flex size-6 items-center justify-center rounded-full text-meta',
              n <= score ? 'bg-accent text-accent-foreground' : 'bg-accent-muted text-accent',
            )}
          >
            ★
          </span>
        ))}
      </span>
    </div>
  );
}
