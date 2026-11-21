import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadRevenue } from '@/lib/admin-revenue';
import { REVENUE_COLUMNS, REVENUE_GRAINS, type RevenueGrain } from '@/lib/admin-revenue/schemas';
import { guardPage } from '@/lib/auth/session';
import { dayFrom } from '@/lib/format/day';

/** Money from the ledger; never cached. */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * A UTC day, moved by `days`. Only a default for the form: Postgres buckets in each region's time zone, and a region east
 * of UTC (TR, KSA) is already on the next day for the last hours of the UTC day, so the default end is the next UTC
 * day, the latest day any region can be on (found by the 17 CI run at 22:54 UTC, D208).
 */
function utcDay(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const MONEY_ROWS = REVENUE_COLUMNS.filter(
  (column) => column !== 'late_received' && column !== 'late_refunded',
);

/**
 * Revenue (spec 0011-16 R-9, R-10, AC-6, AC-7): the ledger summed in Postgres by day or month for an inclusive range,
 * per region and currency. Late payments sit apart and never count as revenue. The CSV link reads the same rows
 * through `/api/admin/revenue`. A plain GET form; `admin_revenue` checks `is_admin()` again.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const query = await searchParams;
  const grain: RevenueGrain = query.grain === 'month' ? 'month' : 'day';
  const from = dayFrom(typeof query.from === 'string' ? query.from : null) ?? utcDay(-29);
  const to = dayFrom(typeof query.to === 'string' ? query.to : null) ?? utcDay(1);
  const outcome = await loadRevenue({ from, to, grain });
  if (!outcome.ok && outcome.code !== 'validation_failed')
    throw new Error(`admin_revenue refused: ${outcome.code}`);
  const t = await getTranslations('AdminRevenue');
  const csv = `/api/admin/revenue?${new URLSearchParams({ from, to, grain }).toString()}`;
  const row = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body-s';
  const select =
    'min-h-11 rounded-block border border-border-light bg-surface px-4 text-body-s text-text-primary';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} intro={t('lead')} />
      <form
        action={`/${locale}/admin/revenue`}
        method="get"
        aria-label={t('title')}
        className="flex flex-col gap-4 rounded-block bg-surface-secondary p-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="revenue-from">{t('from')}</Label>
            <Input id="revenue-from" name="from" type="date" dir="ltr" required defaultValue={from} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="revenue-to">{t('to')}</Label>
            <Input id="revenue-to" name="to" type="date" dir="ltr" required defaultValue={to} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="revenue-grain">{t('grain')}</Label>
            <select id="revenue-grain" name="grain" defaultValue={grain} className={select}>
              {REVENUE_GRAINS.map((value) => (
                <option key={value} value={value}>
                  {t(`grains.${value}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button type="submit">{t('show')}</Button>
          {outcome.ok ? (
            <Button asChild variant="secondary">
              <a href={csv} download>
                {t('download')}
              </a>
            </Button>
          ) : null}
        </div>
      </form>

      {!outcome.ok ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {t('invalid')}
        </p>
      ) : outcome.report.rows.length === 0 ? (
        <EmptyState lead={t('title')} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {outcome.report.rows.map((line) => (
            <li
              key={`${line.region}-${line.currency}-${line.bucket}`}
              className="flex flex-col gap-3 rounded-panel border border-border-light bg-surface p-5"
            >
              <h2 className="text-meta font-bold text-text-secondary">
                <span dir="ltr">{grain === 'month' ? line.bucket.slice(0, 7) : line.bucket}</span> ·{' '}
                {line.region} · {line.currency}
              </h2>
              <dl className="flex flex-col gap-2">
                {MONEY_ROWS.map((column) => (
                  <div key={column} className={row}>
                    <dt className={column === 'net' ? 'font-bold text-text-primary' : 'text-text-secondary'}>
                      {t(`columns.${column}`)}
                    </dt>
                    <dd
                      className={column === 'net' ? 'font-bold text-text-primary' : 'text-text-primary'}
                      dir="ltr"
                    >
                      <MoneyDisplay amount={line[column]} currency={line.currency} />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-2 border-t border-border-light pt-3">
                <p className="text-meta font-bold text-text-secondary">{t('late')}</p>
                <dl className="flex flex-col gap-2">
                  {(['late_received', 'late_refunded'] as const).map((column) => (
                    <div key={column} className={row}>
                      <dt className="text-text-secondary">{t(`columns.${column}`)}</dt>
                      <dd className="text-text-primary" dir="ltr">
                        <MoneyDisplay amount={line[column]} currency={line.currency} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
