import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listRequests, type ListFilters } from '@/lib/admin-requests';
import { ADMIN_PAGE_SIZE, LIST_STATUSES, requestIdFrom } from '@/lib/admin-requests/constants';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { dayFrom } from '@/lib/format/day';
import { Link } from '@/lib/i18n/navigation';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';

/** Admin data; never cached. */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const REGIONS = ['TR', 'KSA'] as const;

function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The request list (spec 0011-16 R-1, R-2, AC-1): every region, newest first, 20 a page, filtered by status, region,
 * created day range and "has an open flag". No name, phone, address or note is read. `?id=` keeps 12's "Find request
 * by id": a valid id goes to its page, anything else back home with `?find=invalid` (spec 0011-12 AC-12). A plain
 * GET form, so it works before the page hydrates. `admin_requests` checks `is_admin()` again.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const query = await searchParams;
  if (query.id !== undefined) {
    const id = typeof query.id === 'string' ? requestIdFrom(query.id) : null;
    redirect(id ? `/${locale}/admin/requests/${id}` : `/${locale}/admin?find=invalid`);
  }

  const status = one(query.status);
  const region = one(query.region);
  const filters: ListFilters = {
    status: status && (LIST_STATUSES as readonly string[]).includes(status) ? status : null,
    region: region === 'TR' || region === 'KSA' ? region : null,
    from: dayFrom(one(query.from)),
    to: dayFrom(one(query.to)),
    hasFlag: query.flag === '1' ? true : null,
    page: Math.max(1, Number.parseInt(one(query.page) ?? '1', 10) || 1),
  };
  const outcome = await listRequests(filters);
  if ('ok' in outcome && outcome.code !== 'validation_failed') {
    throw new Error(`admin_requests refused: ${outcome.code}`);
  }
  const list = 'ok' in outcome ? null : outcome;
  const t = await getTranslations('AdminRequests');
  const tFlag = await getTranslations('AdminRequests.flag');
  const pages = list ? Math.max(1, Math.ceil(list.total / ADMIN_PAGE_SIZE)) : 1;

  const href = (page: number) => {
    const search = new URLSearchParams();
    if (filters.status) search.set('status', filters.status);
    if (filters.region) search.set('region', filters.region);
    if (filters.from) search.set('from', filters.from);
    if (filters.to) search.set('to', filters.to);
    if (filters.hasFlag) search.set('flag', '1');
    if (page > 1) search.set('page', String(page));
    const text = search.toString();
    return `/admin/requests${text ? `?${text}` : ''}`;
  };
  const select =
    'min-h-11 rounded-block border border-border-light bg-surface px-4 text-body-s text-text-primary';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('listTitle')} intro={t('listIntro')} />

      <form
        action={`/${locale}/admin/requests`}
        method="get"
        aria-label={t('filters')}
        className="flex flex-col gap-4 rounded-block bg-surface-secondary p-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-status">{t('filterStatus')}</Label>
            <select id="filter-status" name="status" defaultValue={filters.status ?? ''} className={select}>
              <option value="">{t('any')}</option>
              {LIST_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-region">{t('filterRegion')}</Label>
            <select id="filter-region" name="region" defaultValue={filters.region ?? ''} className={select}>
              <option value="">{t('any')}</option>
              {REGIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-from">{t('from')}</Label>
            <Input id="filter-from" name="from" type="date" dir="ltr" defaultValue={filters.from ?? ''} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-to">{t('to')}</Label>
            <Input id="filter-to" name="to" type="date" dir="ltr" defaultValue={filters.to ?? ''} />
          </div>
        </div>
        <label className="inline-flex min-h-11 items-center gap-3 text-body-s text-text-primary">
          <input
            type="checkbox"
            name="flag"
            value="1"
            defaultChecked={filters.hasFlag === true}
            className="size-5 accent-accent"
          />
          {t('hasFlag')}
        </label>
        <div className="flex flex-wrap gap-2.5">
          <Button type="submit">{t('apply')}</Button>
          <Button asChild variant="secondary">
            <Link href="/admin/requests">{t('reset')}</Link>
          </Button>
        </div>
      </form>

      {list === null ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {t('invalidFilter')}
        </p>
      ) : (
        <>
          <p className="text-body-s text-text-secondary" aria-live="polite">
            {t('total', { count: list.total })}
          </p>
          {list.rows.length === 0 ? (
            <EmptyState lead={t('listTitle')} title={t('listEmpty')} body={t('listEmptyBody')} />
          ) : (
            <ul className="flex flex-col gap-3">
              {list.rows.map((row) => {
                const fallback = regionDefaultLocale(row.region);
                return (
                  <li key={row.id}>
                    <Link
                      href={`/admin/requests/${row.id}`}
                      className="flex flex-col gap-2 rounded-panel border border-border-light bg-surface p-5 hover:bg-surface-secondary"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-meta text-text-primary">{row.status}</code>
                        <span className="text-meta text-text-secondary">{row.region}</span>
                        {row.open_flags.map((kind) => (
                          <StatusChip key={kind} tone="negative" label={tFlag(kind)} />
                        ))}
                        {row.open_report ? <StatusChip tone="waiting" label={t('openReport')} /> : null}
                      </div>
                      <span className="font-display text-title-s text-text-primary">
                        {localized(row.service_name, locale, fallback)} ·{' '}
                        {localized(row.zone_name, locale, fallback)}
                      </span>
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body-s text-text-secondary">
                        <span>
                          {t('created', { date: instantLabel(row.created_at, row.timezone, locale) })} ·{' '}
                          {t('start')} {instantLabel(row.scheduled_start_at, row.timezone, locale)}
                        </span>
                        <span className="text-text-primary">
                          <MoneyDisplay amount={row.fixed_price} currency={row.currency} />
                        </span>
                      </span>
                      <span className="font-mono text-meta break-all text-text-secondary" dir="ltr">
                        {row.id}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 ? (
            <nav
              aria-label={t('listPage', { page: filters.page, pages })}
              className="flex flex-wrap items-center gap-3"
            >
              {filters.page > 1 ? (
                <Button asChild variant="secondary">
                  <Link href={href(filters.page - 1)}>{t('prev')}</Link>
                </Button>
              ) : null}
              <span className="text-body-s text-text-secondary">
                {t('listPage', { page: filters.page, pages })}
              </span>
              {filters.page < pages ? (
                <Button asChild variant="secondary">
                  <Link href={href(filters.page + 1)}>{t('next')}</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
