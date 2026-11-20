import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { loadHistory, type History, type HistoryRow } from '@/lib/provider-feed';
import {
  applicationTone,
  historyMonthParam,
  jobTabFor,
  parseHistoryMonth,
} from '@/lib/provider-feed/constants';
import { instantLabel, monthLabel, regionDefaultLocale } from '@/lib/requests/view';
import { cn } from '@/lib/utils';

/** The provider's own fee rows: never cached between providers. */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Jobs and fees (spec 0011-15): each job the provider unlocked in one month, by its scheduled start, with the cash
 * the customer pays them in person, the fee they paid and any refund, plus the month's totals. Read only: every
 * figure comes from Postgres and is only formatted here (rule 4). There is no balance, no withdrawal and no top up
 * (rule 9, D91); P9's list and filter layout only.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const query = await searchParams;
  const t = await getTranslations('History');
  const tFeed = await getTranslations('ProviderFeed');
  const context = { region: user.region };

  // R-10: a month outside the window falls back to the current month.
  const asked = parseHistoryMonth(query.month);
  let result = await loadHistory(asked, context);
  if (!result.ok && result.code === 'validation_failed' && asked !== null) {
    result = await loadHistory(null, context);
  }

  const header = <PageHeader title={t('title')} intro={t('intro')} />;
  if (!result.ok) {
    return (
      <>
        {header}
        <ErrorState title={t('error.title')} body={t('error.body')} />
      </>
    );
  }

  const history: History = result.history;
  const { currency, timezone, totals } = history;
  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const money = (amount: number, className?: string) => (
    <MoneyDisplay amount={amount} currency={currency} className={className} />
  );

  const picker = (
    <nav aria-label={t('months')} className="flex flex-col gap-2">
      <p className="text-body-s text-text-secondary">{t('byJobDate')}</p>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
        {history.months.map((month) => (
          <li key={month} className="shrink-0">
            <Link
              href={{ pathname: '/provider/history', query: { month: historyMonthParam(month) } }}
              aria-current={month === history.month ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full px-5 py-2.5 text-btn-sm whitespace-nowrap',
                month === history.month
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-surface-secondary text-text-primary',
              )}
            >
              {monthLabel(month, locale)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  const stat = (label: string, value: ReactNode, note?: string) => (
    <div className="flex flex-col gap-1.5 rounded-panel bg-accent-light p-5">
      <dt className="text-body-s text-text-secondary">{label}</dt>
      <dd className="font-display text-card text-text-primary">{value}</dd>
      {note ? <dd className="text-meta text-text-secondary">{note}</dd> : null}
    </div>
  );

  const row = (item: HistoryRow) => {
    const cancelled = item.request_status === 'CANCELLED';
    return (
      <li key={item.application_id} className="flex flex-col gap-3 rounded-card bg-surface-secondary p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-card text-text-primary">
              {localized(item.service_name, locale, fallback)}
            </h3>
            <p className="text-body-s text-text-secondary">
              {instantLabel(item.scheduled_start_at, timezone, locale)}
            </p>
          </div>
          <StatusChip
            tone={applicationTone(item.application_status)}
            label={tFeed(`status.${item.application_status}`)}
          />
        </div>
        <dl className="flex flex-col gap-2 rounded-block bg-surface p-4 text-body-s">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-secondary">{t('cash')}</dt>
            <dd className="font-semibold text-text-primary">
              {money(item.cash_due, cancelled ? 'line-through' : undefined)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-secondary">{t('fee')}</dt>
            <dd className="font-semibold text-text-primary">{money(item.fee_amount)}</dd>
          </div>
          {item.refund_state === 'done' && item.refund_amount !== null ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-text-secondary">{t('refundDone')}</dt>
              <dd className="font-semibold text-text-primary">{money(item.refund_amount)}</dd>
            </div>
          ) : null}
        </dl>
        {item.refund_state === 'pending' ? (
          <p role="status" className="text-body-s text-text-primary">
            {t('refundPending')}
          </p>
        ) : null}
        {cancelled ? <p className="text-body-s text-text-secondary">{t('cancelled')}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link
              href={{
                pathname: '/provider/applications',
                query: { tab: jobTabFor(item.application_status) },
              }}
            >
              {t('openJob')}
            </Link>
          </Button>
          {item.receipt_id ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/receipts/${item.receipt_id}`}>{t('receipt')}</Link>
            </Button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <>
      {header}
      {picker}
      <section aria-labelledby="history-totals" className="flex flex-col gap-3">
        <h2 id="history-totals" className="font-display text-section text-text-primary">
          {t('totals')} · {monthLabel(history.month, locale)}
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {stat(t('jobs'), <span className="tabular-nums">{totals.jobs}</span>)}
          {stat(t('feesPaid'), money(totals.fees_paid))}
          {stat(t('refunds'), money(totals.refunds))}
          {stat(t('netFees'), money(totals.net_fees))}
          {stat(t('cashClosed'), money(totals.cash_closed), t('cashClosedNote'))}
        </dl>
      </section>
      {history.rows.length === 0 ? (
        <EmptyState
          lead={t('empty.lead')}
          title={t('empty.title')}
          body={t('empty.body')}
          action={
            <Button asChild size="lg">
              <Link href="/provider/feed">{t('empty.action')}</Link>
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="history-rows" className="flex flex-col gap-3">
          <h2 id="history-rows" className="font-display text-section text-text-primary">
            {t('rows')}
          </h2>
          {history.truncated ? (
            <p role="status" className="text-body-s text-text-secondary">
              {t('truncated')}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3.5">{history.rows.map(row)}</ul>
        </section>
      )}
    </>
  );
}
