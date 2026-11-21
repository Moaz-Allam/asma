import { barPercent } from '@/lib/ratings/summary';

export type RatingBar = { key: string; label: string; value: number; text: string };

/**
 * The four dimensions as bars (ui-registry `RatingBars`, s8, spec 0011-17 AC-5, AC-7): the label, the figure as
 * text, and a bar whose width is the figure over 5 (display only). The bar is decorative; the text carries the value.
 */
export function RatingBars({ rows }: { rows: readonly RatingBar[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-body-s text-text-primary">{row.label}</dt>
            <dd className="text-body-s font-bold text-text-primary">{row.text}</dd>
          </div>
          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-accent-muted">
            <div className="h-full rounded-full bg-accent" style={{ width: barPercent(row.value) }} />
          </div>
        </div>
      ))}
    </dl>
  );
}
