import { useTranslations } from 'next-intl';

import { SectionHead } from '@/components/features/landing/SectionHead';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { SAMPLE_ADDONS, SAMPLE_CURRENCY, SAMPLE_PRICES } from '@/lib/landing/samples';
import { cn } from '@/lib/utils';

/** The price cards of `s1`, with sample amounts until the catalog replaces them (AC-28). */
export function Prices() {
  const t = useTranslations('Landing');

  return (
    <section id="prices" className="scroll-mt-6 pt-12 lg:pt-15">
      <SectionHead title={t('pricesTitle')} action={t('pricesAll')} className="mb-5.5" />
      <ul className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {SAMPLE_PRICES.map((price) => (
          <li
            key={price.key}
            className={cn(
              'rounded-card border-2 p-4 xl:p-6.5',
              price.featured ? 'border-accent-light bg-accent-light' : 'border-border bg-surface',
            )}
          >
            <p
              className={cn(
                'text-label font-semibold',
                price.featured ? 'text-text-primary' : 'text-text-secondary',
              )}
            >
              {t(`price.${price.key}`)}
            </p>
            <p className="my-2">
              <MoneyDisplay
                amount={price.amount}
                currency={SAMPLE_CURRENCY}
                className="text-card text-text-primary min-[23rem]:text-section xl:text-amount"
              />
            </p>
            <p className={cn('text-body-s', price.featured ? 'text-text-primary' : 'text-text-secondary')}>
              {t(`price.${price.note}`)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-body-s text-text-secondary">
        {t('addonsLabel')}{' '}
        {SAMPLE_ADDONS.map((addon, index) => (
          <span key={addon.key}>
            {index > 0 ? ' · ' : null}
            {t(`addon.${addon.key}`)} <MoneyDisplay amount={addon.amount} currency={SAMPLE_CURRENCY} />
          </span>
        ))}
        {'. '}
        {t('pricesNote')}
      </p>
    </section>
  );
}
