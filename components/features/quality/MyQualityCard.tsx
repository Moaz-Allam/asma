import { useLocale, useTranslations } from 'next-intl';

import { formatCount, formatPercent, type CardRate, type MyQuality } from '@/lib/quality/summary';

import { QualityNote } from './QualityLine';

/**
 * "Your quality" on the provider's profile (ui-registry `MyQualityCard`, spec 0011-19a AC-4): the three figures
 * exactly as customers see them, a rate not shown yet saying so, and probation's progress and live job limit while it
 * lasts. Never a flag, the report rate, the cancellation rate or follow through.
 */
export function MyQualityCard({ quality }: { quality: MyQuality }) {
  const t = useTranslations('Quality.mine');
  const locale = useLocale();
  const card = quality.quality;
  const rate = (value: CardRate | null) => (value ? formatPercent(value.pct, locale) : t('notYet'));
  return (
    <section
      aria-labelledby="my-quality-title"
      className="flex flex-col gap-4 rounded-panel border-2 border-border-light bg-surface p-5 lg:p-6"
    >
      <h2 id="my-quality-title" className="font-display text-title-s text-text-primary">
        {t('title')}
      </h2>
      {card === null ? (
        <p className="text-body text-text-secondary">{t('unavailable')}</p>
      ) : (
        <>
          <dl className="flex flex-col gap-2.5">
            {(
              [
                ['jobs', formatCount(card.jobs_done, locale)],
                ['completed', rate(card.completion)],
                ['onTime', rate(card.on_time)],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-body-s text-text-secondary">{t(key)}</dt>
                <dd className="text-body-s font-bold text-text-primary">{value}</dd>
              </div>
            ))}
          </dl>
          <QualityNote quality={card} />
        </>
      )}
      {quality.probation ? (
        <div className="flex flex-col gap-1.5 rounded-block bg-accent-light p-4">
          <p className="text-body-s font-bold text-text-primary">
            {t('probation', {
              needed: quality.probation.jobs_needed,
              done: quality.probation.jobs_done,
            })}
          </p>
          <p className="text-body-s text-text-primary">
            {t('probationLimit', { limit: quality.probation.live_limit })}
          </p>
        </div>
      ) : null}
    </section>
  );
}
