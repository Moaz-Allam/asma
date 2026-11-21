import { useLocale, useTranslations } from 'next-intl';

import { formatScore, RATING_DIMENSIONS, type RatedSummary } from '@/lib/ratings/summary';

import { RatingBars } from './RatingBars';

/**
 * A provider's score on an offer (ui-registry `RatingSummary`, s6 and s8, spec 0011-17 AC-5): "★ 4.8 · 26 ratings",
 * always with the count, and a "See ratings" disclosure with the four dimensions as bars and the line saying who can
 * rate and when admin hides one (`[draft]` until S16). A native disclosure, so it works before hydration. Only for a
 * `rated` summary: New and unavailable are the caller's (the "New" chip, or nothing).
 */
export function RatingSummary({ rating }: { rating: RatedSummary }) {
  const t = useTranslations('Ratings');
  const locale = useLocale();
  const score = formatScore(rating.overall, locale);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-body-s font-bold text-text-primary">
        <span className="sr-only">{t('label', { score, count: rating.count })}</span>
        <span aria-hidden className="inline-flex items-center gap-1.5">
          <span className="text-accent">★</span>
          <span>{score}</span>
          <span className="font-normal text-text-secondary">· {t('count', { count: rating.count })}</span>
        </span>
      </p>
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-body-s font-semibold text-link">
          {t('see')}
        </summary>
        <div className="flex flex-col gap-3 rounded-block bg-surface-secondary p-4">
          <RatingBars
            rows={RATING_DIMENSIONS.map((d) => ({
              key: d,
              label: t(`dimensions.${d}`),
              value: rating[d],
              text: formatScore(rating[d], locale),
            }))}
          />
          <p className="text-meta text-text-secondary">{t('disclosure')}</p>
        </div>
      </details>
    </div>
  );
}
