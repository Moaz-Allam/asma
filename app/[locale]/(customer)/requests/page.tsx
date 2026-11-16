import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RequestRow, rowStatus } from '@/components/features/requests/RequestRow';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { listMyRequests } from '@/lib/requests';
import { parseTab, REQUEST_TABS } from '@/lib/requests/input';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';
import { cn } from '@/lib/utils';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NUMBER_LOCALE: Readonly<Record<string, string>> = { ar: 'ar-u-nu-latn', tr: 'tr', en: 'en' };

/**
 * My requests (spec 0008 AC-13, `s10`): the caller's own requests, newest first, 20 a page, tabs All, Active
 * and Closed. Names come from the stored snapshots, never the live catalog (AC-9).
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['customer', 'admin']);
  const query = await searchParams;
  const t = await getTranslations('Requests');
  const tab = parseTab(query.tab);
  const page = await listMyRequests({ userId: user.id, tab, after: query.after });
  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const posted = (iso: string, timezone: string) =>
    new Intl.DateTimeFormat(NUMBER_LOCALE[locale] ?? locale, {
      day: 'numeric',
      month: 'long',
      timeZone: timezone,
    }).format(new Date(iso));
  const tabHref = (value: string) => (value === 'all' ? '/requests' : `/requests?tab=${value}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-title text-text-primary">{t('list.title')}</h1>
        <Button asChild>
          <Link href="/requests/new">{t('list.newRequest')}</Link>
        </Button>
      </div>
      <nav aria-label={t('list.tabs')}>
        <ul className="flex flex-wrap gap-2">
          {REQUEST_TABS.map((value) => (
            <li key={value}>
              <Link
                href={tabHref(value)}
                aria-current={value === tab ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full px-5 py-2.5 text-btn-sm',
                  value === tab
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface-secondary text-text-primary',
                )}
              >
                {t(`list.${value}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {page.rows.length === 0 ? (
        <EmptyState
          lead={t('list.emptyLead')}
          title={t(`list.empty${tab === 'all' ? 'All' : tab === 'active' ? 'Active' : 'Closed'}Title`)}
          body={t(`list.empty${tab === 'all' ? 'All' : tab === 'active' ? 'Active' : 'Closed'}Body`)}
          action={
            <Button asChild>
              <Link href="/requests/new">{t('list.emptyAction')}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3.5">
          {page.rows.map((row) => {
            const status = rowStatus(row.status, row.scheduled_start_at, page.now);
            const timezone = row.region_info.timezone;
            return (
              <RequestRow
                key={row.id}
                href={`/requests/${row.id}`}
                status={status}
                statusLabel={t(`status.${status}`)}
                title={localized(row.service.name, locale, fallback)}
                district={row.zone_name ? localized(row.zone_name, locale, fallback) : ''}
                start={instantLabel(row.scheduled_start_at, timezone, locale)}
                posted={t('list.posted', { date: posted(row.created_at, timezone) })}
                price={row.fixed_price}
                currency={row.currency}
              />
            );
          })}
        </ul>
      )}

      {page.next ? (
        <Button asChild variant="secondary" className="self-center">
          <Link href={`${tabHref(tab)}${tab === 'all' ? '?' : '&'}after=${page.next}`}>{t('list.more')}</Link>
        </Button>
      ) : null}
    </div>
  );
}
