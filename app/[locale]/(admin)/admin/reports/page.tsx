import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { loadReports } from '@/lib/admin-reports';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { REPORTS_PAGE_SIZE } from '@/lib/reports/constants';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = ['open', 'handled'] as const;

/**
 * The report queue (spec 0011-14 AC-4, X-21): Open, oldest first, and Handled, newest handled first, 20 a page.
 * `admin_reports` checks `is_admin()` again. Each row names the reason, the reporter's side and the service, never
 * the text.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const query = await searchParams;
  const tab = query.tab === 'handled' ? 'handled' : 'open';
  const page = Math.max(1, Number.parseInt(typeof query.page === 'string' ? query.page : '1', 10) || 1);
  const { rows, total } = await loadReports(tab, page);
  const pages = Math.max(1, Math.ceil(total / REPORTS_PAGE_SIZE));
  const t = await getTranslations('AdminReports');
  const tReasons = await getTranslations('Reports.reasons');
  const href = (value: (typeof TABS)[number], number = 1) =>
    `/admin/reports?tab=${value}${number > 1 ? `&page=${number}` : ''}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} intro={t('lead')} />
      <nav aria-label={t('title')}>
        <ul className="flex flex-wrap gap-2">
          {TABS.map((value) => (
            <li key={value}>
              <Link
                href={href(value)}
                aria-current={value === tab ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full px-5 py-2.5 text-btn-sm',
                  value === tab
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface-secondary text-text-primary',
                )}
              >
                {t(`tabs.${value}`)}
                {value === 'open' && tab === 'open' ? ` · ${total}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          lead={t('title')}
          title={tab === 'open' ? t('emptyOpen') : t('emptyHandled')}
          body={t('lead')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const tz = row.timezone;
            return (
              <li key={row.id}>
                <Link
                  href={`/admin/reports/${row.id}`}
                  className="flex flex-col gap-2 rounded-panel border-2 border-border bg-surface p-5 transition-colors hover:border-accent hover:bg-surface-secondary/50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip
                      tone={row.status === 'open' ? 'waiting' : 'neutral'}
                      label={tReasons(row.reason)}
                    />
                    <span className="text-meta text-text-secondary">
                      {row.side === 'customer' ? t('byCustomer') : t('byProvider')} · {row.region}
                    </span>
                  </div>
                  <span className="font-display text-title-s text-text-primary">
                    {localized(row.service, locale, regionDefaultLocale(row.region))}
                  </span>
                  <span className="text-body-s text-text-secondary">
                    {row.status === 'handled' && row.handled_at
                      ? `${t('handledOn', { date: instantLabel(row.handled_at, tz, locale) })} · ${
                          row.outcome ? t(`outcomes.${row.outcome}`) : ''
                        }`
                      : t('reportedOn', { date: instantLabel(row.created_at, tz, locale) })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 ? (
        <nav aria-label={t('page', { page, pages })} className="flex flex-wrap items-center gap-3">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={href(tab, page - 1)}>{t('prev')}</Link>
            </Button>
          ) : null}
          <span className="text-body-s text-text-secondary">{t('page', { page, pages })}</span>
          {page < pages ? (
            <Button asChild variant="secondary">
              <Link href={href(tab, page + 1)}>{t('next')}</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
