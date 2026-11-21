import { useLocale, useTranslations } from 'next-intl';

import { formatScore, RATING_DIMENSIONS, type RatingSummary } from '@/lib/ratings/summary';

import { RatingBars } from './RatingBars';

/**
 * "Your rating" on the provider's profile (ui-registry `MyRatingCard`, spec 0011-17 AC-7): New with the count until 5
 * ratings, then the overall score, the count and the four bars, exactly what customers see. Never a single rating,
 * a date, a request or a customer (decision 4).
 */
export function MyRatingCard({ rating }: { rating: RatingSummary }) {
  const t = useTranslations('Ratings');
  const locale = useLocale();
  return (
    <section
      aria-labelledby="my-rating-title"
      className="flex flex-col gap-4 rounded-panel border-2 border-border-light bg-surface p-5 lg:p-6"
    >
      <h2 id="my-rating-title" className="font-display text-title-s text-text-primary">
        {t('mine.title')}
      </h2>
      {rating.state === 'new' ? (
        <p className="text-body text-text-primary">{t('mine.new', { count: rating.count })}</p>
      ) : rating.state === 'unavailable' ? (
        <p className="text-body text-text-secondary">{t('mine.unavailable')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="flex items-baseline gap-2">
              <span className="sr-only">{t('mine.average')}</span>
              <span aria-hidden className="text-title text-accent">
                ★
              </span>
              <span className="font-display text-title text-text-primary">
                {formatScore(rating.overall, locale)}
              </span>
            </p>
            <p className="pb-1 text-body-s text-text-secondary">{t('mine.from', { count: rating.count })}</p>
          </div>
          <RatingBars
            rows={RATING_DIMENSIONS.map((d) => ({
              key: d,
              label: t(`dimensions.${d}`),
              value: rating[d],
              text: formatScore(rating[d], locale),
            }))}
          />
          <p className="text-meta text-text-secondary">{t('mine.note')}</p>
        </>
      )}
    </section>
  );
}
