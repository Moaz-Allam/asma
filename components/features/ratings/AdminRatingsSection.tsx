import { useLocale, useTranslations } from 'next-intl';

import { StatusChip } from '@/components/shared/StatusChip';
import type { AdminProviderRatings } from '@/lib/admin-ratings';
import { Link } from '@/lib/i18n/navigation';
import { formatScore, RATING_DIMENSIONS } from '@/lib/ratings/summary';
import { instantLabel } from '@/lib/requests/view';

import { HideRatingDialog } from './HideRatingDialog';
import { RatingBars } from './RatingBars';

const PAGE_SIZE = 20;

/**
 * The Ratings section of admin's provider page (ui-registry `AdminRatingsSection`, spec 0011-17 AC-8): what customers
 * see, then every rating newest first, 20 a page, with its date in the region's time zone, its request, its four
 * scores and its hide. A visible rating has Hide; a hidden one says who hid it, when and why. No path changes a score.
 */
export function AdminRatingsSection({
  data,
  page,
  hrefFor,
}: {
  data: AdminProviderRatings;
  page: number;
  hrefFor: (page: number) => string;
}) {
  const t = useTranslations('AdminRatings');
  const tr = useTranslations('Ratings');
  const locale = useLocale();
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const when = (at: string) => instantLabel(at, data.timezone, locale);
  const scores = (row: AdminProviderRatings['rows'][number]) =>
    RATING_DIMENSIONS.map((d) => `${tr(`dimensions.${d}`)} ${row[d]}`).join(' · ');
  const summary = data.summary;

  return (
    <section aria-labelledby="ratings-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ratings-title" className="font-display text-title-s text-text-primary">
          {t('title')}
        </h2>
        <p className="text-body-s text-text-secondary">{t('total', { count: data.total })}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-block bg-surface-secondary p-5">
        <h3 className="text-meta font-bold text-text-secondary">{t('visible')}</h3>
        {summary.state === 'rated' ? (
          <>
            <p className="text-body font-bold text-text-primary">
              <span aria-hidden className="text-accent">
                ★{' '}
              </span>
              {formatScore(summary.overall, locale)}
              <span className="font-normal text-text-secondary">
                {' '}
                · {tr('count', { count: summary.count })}
              </span>
            </p>
            <RatingBars
              rows={RATING_DIMENSIONS.map((d) => ({
                key: d,
                label: tr(`dimensions.${d}`),
                value: summary[d],
                text: formatScore(summary[d], locale),
              }))}
            />
          </>
        ) : summary.state === 'new' ? (
          <p className="text-body-s text-text-primary">{t('newSummary', { count: summary.count })}</p>
        ) : (
          <p role="status" className="text-body-s text-error-foreground">
            {t('unavailable')}
          </p>
        )}
      </div>

      {data.rows.length === 0 ? (
        <p className="text-body-s text-text-secondary">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-light rounded-block border border-border-light">
          {data.rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2.5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body-s font-semibold text-text-primary">{when(row.created_at)}</p>
                {row.hide ? <StatusChip tone="negative" label={t('hidden')} /> : null}
              </div>
              <p className="text-meta text-text-secondary">
                {t('request')}:{' '}
                <Link
                  href={`/admin/requests/${row.request_id}`}
                  className="break-all text-link underline underline-offset-4"
                >
                  {row.request_id}
                </Link>
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                {RATING_DIMENSIONS.map((d) => (
                  <div key={d} className="flex flex-col">
                    <dt className="text-meta text-text-secondary">{tr(`dimensions.${d}`)}</dt>
                    <dd className="text-body-s font-bold text-text-primary">
                      {tr('star', { score: row[d] })}
                    </dd>
                  </div>
                ))}
              </dl>
              {row.hide ? (
                <div className="flex flex-col gap-1 rounded-block bg-error-light p-3">
                  <p className="text-meta font-bold text-text-primary">
                    {t('hiddenBy', {
                      name: row.hide.hidden_by_name ?? t('someone'),
                      date: when(row.hide.hidden_at),
                    })}
                    {' · '}
                    {t(`reasons.${row.hide.reason}`)}
                  </p>
                  <p className="text-meta break-words whitespace-pre-line text-text-primary" dir="auto">
                    {row.hide.note}
                  </p>
                </div>
              ) : (
                <div>
                  <HideRatingDialog
                    ratingId={row.id}
                    body={t('dialogBody', { date: when(row.created_at), scores: scores(row) })}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label={t('title')} className="flex flex-wrap items-center justify-between gap-3">
          {page > 1 ? (
            <Link
              href={hrefFor(page - 1)}
              className="inline-flex min-h-11 items-center text-btn-sm text-link"
            >
              {t('previous')}
            </Link>
          ) : (
            <span />
          )}
          <p className="text-meta text-text-secondary">{t('page', { page, pages })}</p>
          {page < pages ? (
            <Link
              href={hrefFor(page + 1)}
              className="inline-flex min-h-11 items-center text-btn-sm text-link"
            >
              {t('next')}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
