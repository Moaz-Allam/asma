import { useLocale, useTranslations } from 'next-intl';

import { formatPercent, windowSpan, type CardQuality } from '@/lib/quality/summary';

/**
 * A provider's jobs on Aldebyani and the two rates customers see (ui-registry `QualityLine`, s6, spec 0011-19a AC-3):
 * "12 jobs on Aldebyani · 92% completed · 88% on time", each rate only once enough jobs count. Nothing shows before
 * the first job, or when the figures are unavailable (null). Display only: Postgres computes every figure when read.
 */
export function QualityLine({ quality }: { quality: CardQuality | null }) {
  const t = useTranslations('Quality.card');
  const locale = useLocale();
  if (quality === null || quality.jobs_done < 1) return null;
  const parts = [t('jobs', { count: quality.jobs_done })];
  if (quality.completion) parts.push(t('completed', { pct: formatPercent(quality.completion.pct, locale) }));
  if (quality.on_time) parts.push(t('onTime', { pct: formatPercent(quality.on_time.pct, locale) }));
  return <p className="text-body-s text-text-primary">{parts.join(' · ')}</p>;
}

/** AC-3, X-19: how the figures are counted, with the window and the grace from the card's own shape. */
export function QualityNote({ quality }: { quality: CardQuality }) {
  const t = useTranslations('Quality.card');
  const span = windowSpan(quality.window_days);
  const window =
    span.unit === 'months'
      ? t('windowMonths', { count: span.count })
      : t('windowDays', { count: span.count });
  return (
    <p className="text-meta text-text-secondary">{t('note', { window, grace: quality.grace_minutes })}</p>
  );
}

/** The note in a disclosure of its own, for a provider who is not rated (a rated one shows it in "See ratings"). */
export function QualityDisclosure({ quality }: { quality: CardQuality }) {
  const t = useTranslations('Quality.card');
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-body-s font-semibold text-link">
        {t('how')}
      </summary>
      <div className="rounded-block bg-surface-secondary p-4">
        <QualityNote quality={quality} />
      </div>
    </details>
  );
}

/** Whether the card shows a quality line (and so its note). */
export function showsQuality(quality: CardQuality | null): quality is CardQuality {
  return quality !== null && quality.jobs_done >= 1;
}
