import type { ReactNode } from 'react';

import { MoneyDisplay } from '@/components/shared/MoneyDisplay';

/**
 * The price panel (ui-registry `PriceCard`, `s4`, `s5`): an eyebrow, the job price large, the fired lines,
 * then the split, online after choosing a provider and in cash to the provider after the service (D87).
 * Display only: every figure is the server's, in minor units (rule 1, rule 4). A line never multiplies on
 * the client; a per unit line shows its amount and its count.
 */

export type PriceLine = {
  key: string;
  label: string;
  /** A fixed amount, or a per unit amount shown with its count. */
  amount?: number;
  units?: number;
  /** A multiplier as the server sent it, such as `1.30`. */
  factor?: string;
};

export type PriceFigures = {
  price: number;
  commission: number;
  cashDue: number;
  currency: 'TRY' | 'SAR';
  lines: readonly PriceLine[];
};

export function PriceCard({
  eyebrow,
  figures,
  placeholder,
  labels,
  note,
  children,
}: {
  eyebrow: string;
  /** The server's figures, or null while a placeholder explains what is missing. */
  figures: PriceFigures | null;
  placeholder?: ReactNode;
  labels: { online: string; cash: string; total: string; breakdown: string };
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-label={eyebrow} className="flex flex-col gap-4 rounded-panel bg-accent-light p-5 lg:p-7.5">
      <p className="text-body-s font-semibold text-text-primary">{eyebrow}</p>
      <div aria-live="polite" className="flex flex-col gap-4">
        {figures ? (
          <>
            <MoneyDisplay
              amount={figures.price}
              currency={figures.currency}
              className="text-amount text-text-primary sm:text-price-l"
            />
            {figures.lines.length > 0 ? (
              <ul aria-label={labels.breakdown} className="flex flex-col gap-2 rounded-block bg-surface p-4">
                {figures.lines.map((line) => (
                  <li key={line.key} className="flex items-baseline justify-between gap-3 text-body-s">
                    <span className="text-text-primary">{line.label}</span>
                    <span className="font-bold text-text-primary">
                      {line.amount !== undefined ? (
                        <MoneyDisplay amount={line.amount} currency={figures.currency} />
                      ) : null}
                      {line.units !== undefined ? <span dir="ltr"> × {line.units}</span> : null}
                      {line.factor !== undefined ? <span dir="ltr">× {line.factor}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <dl className="flex flex-col gap-2 rounded-block bg-surface p-4 text-body-s">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-primary">{labels.online}</dt>
                <dd className="font-bold text-text-primary">
                  <MoneyDisplay amount={figures.commission} currency={figures.currency} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-primary">{labels.cash}</dt>
                <dd className="font-bold text-text-primary">
                  <MoneyDisplay amount={figures.cashDue} currency={figures.currency} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border-light pt-2">
                <dt className="font-semibold text-text-primary">{labels.total}</dt>
                <dd className="font-bold text-text-primary">
                  <MoneyDisplay amount={figures.price} currency={figures.currency} />
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="text-body text-text-lede">{placeholder}</div>
        )}
      </div>
      {children}
      {note ? <p className="text-meta text-text-secondary">{note}</p> : null}
    </section>
  );
}
