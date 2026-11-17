import type { ReactNode } from 'react';

import { MoneyDisplay } from '@/components/shared/MoneyDisplay';

/**
 * After the choose (ui-registry `NextStepPanel`, spec 0010 AC-9, spec 0011-09 AC-10): the split of the job price
 * into the commission paid online now and the cash paid to the provider after the job, the stored deadline in
 * the region's time zone, then the page's action (09's agreement line and Pay button, or the line that the
 * payment time ended). Display only; every figure is the request's stored minor units.
 */
export function NextStepPanel({
  labels,
  price,
  commission,
  cashDue,
  currency,
  children,
}: {
  /** No deadline line once the payment time has ended (review F4). */
  labels: { title: string; price: string; commission: string; cash: string; deadline?: string };
  price: number;
  commission: number;
  cashDue: number;
  currency: 'TRY' | 'SAR';
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={labels.title}
      className="flex flex-col gap-4 rounded-panel bg-accent-light p-5 lg:p-7.5"
    >
      <h2 className="font-display text-title-s text-text-primary">{labels.title}</h2>
      <dl className="flex flex-col gap-2 rounded-block bg-surface p-4 text-body-s">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">{labels.price}</dt>
          <dd className="font-semibold text-text-primary">
            <MoneyDisplay amount={price} currency={currency} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-primary">{labels.commission}</dt>
          <dd className="font-bold text-text-primary">
            <MoneyDisplay amount={commission} currency={currency} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-primary">{labels.cash}</dt>
          <dd className="font-bold text-text-primary">
            <MoneyDisplay amount={cashDue} currency={currency} />
          </dd>
        </div>
      </dl>
      {labels.deadline ? (
        <p className="text-body font-semibold text-text-primary">{labels.deadline}</p>
      ) : null}
      {children}
    </section>
  );
}
