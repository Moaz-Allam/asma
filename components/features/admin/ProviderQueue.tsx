import { getFormatter, getTranslations } from 'next-intl/server';

import { STANDING_TONE } from '@/components/features/provider/StandingChip';
import { EmptyState } from '@/components/shared/EmptyState';
import { InitialAvatar } from '@/components/shared/InitialAvatar';
import { StatusChip } from '@/components/shared/StatusChip';
import { Link } from '@/lib/i18n/navigation';
import { queuePage, queueSearch, type QueueQuery } from '@/lib/provider/admin-queries';
import { QUEUE_SORTS, QUEUE_TABS } from '@/lib/provider/options';
import { cn } from '@/lib/utils';

/**
 * The provider queue (`app-03`, AC-14): four tabs, two sorts, 20 a page. A Server Component, rendered by both
 * the list page and the file page, because a layout gets no `searchParams` and does not rerender. Row links
 * carry the query, so the queue stays as it was beside the file.
 */
export async function ProviderQueue({ query, currentId }: { query: QueueQuery; currentId?: string }) {
  const t = await getTranslations('Admin.queue');
  const tStanding = await getTranslations('Provider.standing');
  const tReason = await getTranslations('Provider.reviewReason');
  const format = await getFormatter();
  const page = await queuePage(query);

  const href = (next: Partial<QueueQuery>) => ({
    pathname: '/admin/providers',
    query: Object.fromEntries(new URLSearchParams(queueSearch({ ...query, ...next }))),
  });

  return (
    <section aria-labelledby="queue-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="queue-title" className="sr-only">
        {t('title')}
      </h2>
      <nav aria-label={t('tabsLabel')} className="flex flex-wrap gap-2">
        {QUEUE_TABS.map((tab) => (
          <Link
            key={tab}
            href={href({ tab, page: 1 })}
            aria-current={tab === query.tab ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-5 py-3 text-btn-sm',
              tab === query.tab
                ? 'bg-accent text-accent-foreground'
                : 'bg-surface-secondary text-text-primary',
            )}
          >
            {t(`tabs.${tab}`)}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta text-text-secondary">{t('sortLabel')}</span>
        {QUEUE_SORTS.map((sort) => (
          <Link
            key={sort}
            href={href({ sort, page: 1 })}
            aria-current={sort === query.sort ? 'true' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-4.5 py-2.5 text-btn-sm',
              sort === query.sort
                ? 'bg-accent text-accent-foreground'
                : 'bg-surface-secondary text-text-primary',
            )}
          >
            {t(`sort.${sort}`)}
          </Link>
        ))}
      </div>

      {page.entries.length === 0 ? (
        <EmptyState lead="0" title={t(`empty.${query.tab}`)} body={t('emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {page.entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/admin/providers/${entry.id}?${queueSearch({ ...query, page: page.page })}`}
                aria-current={entry.id === currentId ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3.5 rounded-block border-2 p-4.5',
                  entry.id === currentId ? 'border-accent' : 'border-border hover:border-accent-light',
                )}
              >
                <InitialAvatar name={entry.name} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-body-s font-bold text-text-primary">{entry.name}</span>
                  <span className="text-meta text-text-secondary">
                    {entry.date
                      ? t(query.tab === 'pending' ? 'submitted' : 'decided', {
                          date: format.dateTime(new Date(entry.date), { dateStyle: 'medium' }),
                        })
                      : null}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5">
                  <StatusChip tone={STANDING_TONE[entry.status]} label={tStanding(entry.status)} />
                  {query.tab === 'pending' && entry.reviewReason ? (
                    <StatusChip tone="info" label={tReason(entry.reviewReason)} />
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page.pages > 1 ? (
        <nav aria-label={t('pagesLabel')} className="flex items-center gap-3">
          {page.page > 1 ? (
            <Link
              href={href({ page: page.page - 1 })}
              className="inline-flex min-h-11 items-center rounded-full bg-surface-secondary px-4.5 text-btn-sm"
            >
              {t('prev')}
            </Link>
          ) : null}
          <span className="text-meta text-text-secondary">
            {t('page', { page: page.page, pages: page.pages })}
          </span>
          {page.page < page.pages ? (
            <Link
              href={href({ page: page.page + 1 })}
              className="inline-flex min-h-11 items-center rounded-full bg-surface-secondary px-4.5 text-btn-sm"
            >
              {t('next')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
