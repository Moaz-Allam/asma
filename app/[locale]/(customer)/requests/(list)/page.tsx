import { ShieldCheck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RequestRow, rowStatus } from '@/components/features/requests/RequestRow';
import { EmailNudge } from '@/components/shared/EmailNudge';
import { EmptyState } from '@/components/shared/EmptyState';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { Button } from '@/components/ui/button';
import { needsEmailNudge } from '@/lib/account/profile';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { listMyRequests } from '@/lib/requests';
import { parseTab, REQUEST_TABS } from '@/lib/requests/input';
import { instantLabel, NUMBER_LOCALE, regionDefaultLocale } from '@/lib/requests/view';
import { cn } from '@/lib/utils';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * My requests (spec 0008 AC-13, `s10`): the caller's own requests, newest first, 20 a page, tabs All, Active
 * and Closed, in `s10`'s 2-column composition (action & summary sidebar beside the request list).
 * Names come from the stored snapshots, never the live catalog (AC-9).
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['customer', 'admin']);
  const query = await searchParams;
  const t = await getTranslations('Requests');
  const tab = parseTab(query.tab);
  const page = await listMyRequests({ userId: user.id, tab, after: query.after });
  // Spec 0011-13 AC-4: a nudge, never a block, while mail is on and the address is not confirmed.
  const emailNudge = user.role === 'customer' ? await needsEmailNudge(user.id, 'customer') : false;
  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const posted = (iso: string, timezone: string) =>
    new Intl.DateTimeFormat(NUMBER_LOCALE[locale] ?? locale, {
      day: 'numeric',
      month: 'long',
      timeZone: timezone,
    }).format(new Date(iso));
  const tabHref = (value: string) => (value === 'all' ? '/requests' : `/requests?tab=${value}`);

  const urgent = page.rows.find((row) => row.status === 'SELECTED' || row.status === 'AWAITING_CONFIRMATION');
  const activeCount = page.rows.filter((row) => {
    const s = rowStatus(row.status, row.scheduled_start_at, page.now);
    return s !== 'COMPLETED' && s !== 'CANCELLED' && s !== 'EXPIRED';
  }).length;
  const completedCount = page.rows.filter((row) => row.status === 'COMPLETED').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-title text-text-primary">{t('list.title')}</h1>
        <Button asChild size="lg">
          <Link href="/requests/new">{t('list.newRequest')}</Link>
        </Button>
      </div>
      {emailNudge ? <EmailNudge text={t('emailBanner.text')} linkLabel={t('emailBanner.link')} /> : null}
      <nav aria-label={t('list.tabs')}>
        <ul className="flex flex-wrap gap-2">
          {REQUEST_TABS.map((value) => (
            <li key={value}>
              <Link
                href={tabHref(value)}
                aria-current={value === tab ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full px-5 py-2.5 text-btn-sm transition-colors',
                  value === tab
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface-secondary text-text-primary hover:bg-accent-muted',
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
            <Button asChild size="lg">
              <Link href="/requests/new">{t('list.emptyAction')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
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
                    openLabel={t('list.openDetails')}
                  />
                );
              })}
            </ul>
            {page.next ? (
              <Button asChild variant="secondary" className="self-center">
                <Link href={`${tabHref(tab)}${tab === 'all' ? '?' : '&'}after=${page.next}`}>
                  {t('list.more')}
                </Link>
              </Button>
            ) : null}
          </div>

          <aside className="flex flex-col gap-3.5 max-lg:order-first lg:sticky lg:top-4">
            {urgent ? (
              <section className="flex flex-col gap-3.5 rounded-panel bg-accent-light p-6 lg:p-7">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 rounded-full bg-accent" />
                  <span className="text-eyebrow uppercase text-text-primary">{t('list.needsAction')}</span>
                </div>
                <h2 className="font-display text-card text-text-primary">
                  {localized(urgent.service.name, locale, fallback)}
                </h2>
                <p className="text-body-s text-text-secondary">{t(`status.${urgent.status}`)}</p>
                <div className="flex items-baseline justify-between rounded-row bg-surface px-4 py-3">
                  <span className="text-body-s text-text-secondary">
                    {urgent.status === 'SELECTED' ? t('price.online') : t('price.total')}
                  </span>
                  <MoneyDisplay
                    amount={urgent.status === 'SELECTED' ? urgent.commission_amount : urgent.fixed_price}
                    currency={urgent.currency}
                    className="font-bold text-text-primary"
                  />
                </div>
                <Button asChild size="block">
                  <Link href={`/requests/${urgent.id}`}>
                    {urgent.status === 'SELECTED' ? t('list.payAction') : t('list.confirmAction')}
                  </Link>
                </Button>
              </section>
            ) : null}

            <section className="flex flex-col gap-4 rounded-panel bg-surface-secondary p-6">
              <h2 className="text-eyebrow uppercase text-text-secondary">{t('list.summaryTitle')}</h2>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div className="flex flex-col gap-1 rounded-row bg-surface p-3">
                  <dd className="font-display text-tile tabular-nums text-text-primary">
                    {page.rows.length}
                  </dd>
                  <dt className="text-meta text-text-secondary">{t('list.summaryShown')}</dt>
                </div>
                <div className="flex flex-col gap-1 rounded-row bg-surface p-3">
                  <dd className="font-display text-tile tabular-nums text-text-primary">{activeCount}</dd>
                  <dt className="text-meta text-text-secondary">{t('list.summaryActive')}</dt>
                </div>
                <div className="flex flex-col gap-1 rounded-row bg-surface p-3">
                  <dd className="font-display text-tile tabular-nums text-text-primary">{completedCount}</dd>
                  <dt className="text-meta text-text-secondary">{t('list.summaryCompleted')}</dt>
                </div>
              </dl>
              <div className="flex items-start gap-2.5 border-t-2 border-border pt-3.5 text-meta text-text-secondary">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-text-primary" />
                <p>{t('list.privacyNote')}</p>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
