import { MoneyDisplay } from '@/components/shared/MoneyDisplay';

/**
 * After the choose (ui-registry `NextStepPanel`, spec 0010 AC-9): the commission to pay online, the cash to
 * the provider after the service, and the stored deadline in the region's time zone. 09 puts the pay button
 * where `soon` stands. Display only; every figure is the request's stored minor units.
 */
export function NextStepPanel({
  labels,
  commission,
  cashDue,
  currency,
}: {
  labels: { title: string; commission: string; cash: string; deadline: string; soon: string };
  commission: number;
  cashDue: number;
  currency: 'TRY' | 'SAR';
}) {
  return (
    <section
      aria-label={labels.title}
      className="flex flex-col gap-4 rounded-panel bg-accent-light p-5 lg:p-7.5"
    >
      <h2 className="font-display text-title-s text-text-primary">{labels.title}</h2>
      <dl className="flex flex-col gap-2 rounded-block bg-surface p-4 text-body-s">
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
      <p className="text-body font-semibold text-text-primary">{labels.deadline}</p>
      <p className="text-body-s text-text-secondary">{labels.soon}</p>
    </section>
  );
}
