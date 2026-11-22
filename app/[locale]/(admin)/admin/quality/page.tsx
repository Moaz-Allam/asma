import { getTranslations, setRequestLocale } from 'next-intl/server';

import { QualityAction } from '@/components/features/admin/quality/QualityAction';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { loadFunnel, loadProbation, loadQualityFlags } from '@/lib/admin-quality';
import { FUNNEL_STAGES } from '@/lib/admin-quality/schemas';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { flagFigure, formatCount } from '@/lib/quality/summary';
import { instantLabel, NUMBER_LOCALE } from '@/lib/requests/view';
import { cn } from '@/lib/utils';

/** Admin data; never cached. */
export const dynamic = 'force-dynamic';

const TABS = ['watchlist', 'probation', 'funnel'] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 20;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Trust and quality for admin (spec 0011-19a AC-10 to AC-12): the watchlist of open flags with Warn, Suspend and
 * Clear; the providers on probation with End probation; the funnel by stage and the acceptance rate by month. Each
 * reader checks `is_admin()` again. Nothing here reaches a customer, and no public claim uses these figures (B7).
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const query = await searchParams;
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : 'watchlist';
  const page = Math.max(1, Number.parseInt(typeof query.page === 'string' ? query.page : '1', 10) || 1);
  const t = await getTranslations('Quality.admin');
  const href = (value: Tab, number = 1) =>
    `/admin/quality?tab=${value}${number > 1 ? `&page=${number}` : ''}`;

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
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {tab === 'watchlist' ? (
        <Watchlist locale={locale} page={page} href={(n) => href('watchlist', n)} />
      ) : tab === 'probation' ? (
        <ProbationList locale={locale} page={page} href={(n) => href('probation', n)} />
      ) : (
        <FunnelTab locale={locale} />
      )}
    </div>
  );
}

async function Pager({ page, total, href }: { page: number; total: number; href: (n: number) => string }) {
  const t = await getTranslations('Quality.admin');
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('page', { page, pages })} className="flex flex-wrap items-center gap-3">
      {page > 1 ? (
        <Button asChild variant="secondary">
          <Link href={href(page - 1)}>{t('prev')}</Link>
        </Button>
      ) : null}
      <span className="text-body-s text-text-secondary">{t('page', { page, pages })}</span>
      {page < pages ? (
        <Button asChild variant="secondary">
          <Link href={href(page + 1)}>{t('next')}</Link>
        </Button>
      ) : null}
    </nav>
  );
}

async function Watchlist({
  locale,
  page,
  href,
}: {
  locale: string;
  page: number;
  href: (n: number) => string;
}) {
  const t = await getTranslations('Quality.admin');
  const { rows, total } = await loadQualityFlags(page);
  if (rows.length === 0) {
    return <EmptyState lead={t('tabs.watchlist')} title={t('emptyWatchlist')} body={t('lead')} />;
  }
  return (
    <>
      <p className="text-body-s text-text-secondary">{t('openCount', { count: total })}</p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const words = flagFigure(row.kind, row.figure, locale);
          const figure = t(words.key as 'figure.rating', words.values);
          const name = row.provider_name ?? t('unnamed');
          const suspendable = row.standing === 'approved' || row.standing === 'document_expired';
          return (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-panel border border-border-light bg-surface p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone="negative" label={t(`kind.${row.kind}`)} />
                <span className="text-meta text-text-secondary">{row.region}</span>
              </div>
              <Link href={`/admin/providers/${row.provider_id}`} className="text-body font-bold text-link">
                {name}
              </Link>
              <p className="text-body-s text-text-primary">{figure}</p>
              <p className="text-meta text-text-secondary">
                {t('raised', { date: instantLabel(row.raised_at, row.timezone, locale) })}
              </p>
              <div className="flex flex-wrap items-start gap-2.5">
                <QualityAction mode="warned" targetId={row.id} provider={name} figure={figure} />
                {suspendable ? (
                  <QualityAction mode="suspended" targetId={row.id} provider={name} figure={figure} />
                ) : null}
                <QualityAction mode="cleared" targetId={row.id} provider={name} figure={figure} />
              </div>
            </li>
          );
        })}
      </ul>
      <Pager page={page} total={total} href={href} />
    </>
  );
}

async function ProbationList({
  locale,
  page,
  href,
}: {
  locale: string;
  page: number;
  href: (n: number) => string;
}) {
  const t = await getTranslations('Quality.admin');
  const { rows, total } = await loadProbation(page);
  if (rows.length === 0) {
    return <EmptyState lead={t('tabs.probation')} title={t('emptyProbation')} body={t('lead')} />;
  }
  return (
    <>
      <p className="text-body-s text-text-secondary">{t('probationCount', { count: total })}</p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const name = row.provider_name ?? t('unnamed');
          const progress = t('progress', { done: row.jobs_done, needed: row.jobs_needed });
          return (
            <li
              key={row.provider_id}
              className="flex flex-col gap-2 rounded-panel border border-border-light bg-surface p-5"
            >
              <Link href={`/admin/providers/${row.provider_id}`} className="text-body font-bold text-link">
                {name}
              </Link>
              <p className="text-meta text-text-secondary">
                {row.region}
                {row.approved_at
                  ? ` · ${t('approvedOn', { date: instantLabel(row.approved_at, row.timezone, locale) })}`
                  : ''}
              </p>
              <p className="text-body-s text-text-primary">{progress}</p>
              <p className="text-body-s text-text-primary">
                {t('live', { live: row.live, limit: row.live_limit })} ·{' '}
                {t('reports', { count: row.reports })} · {t('openFlags', { count: row.open_flags })}
              </p>
              <div className="flex flex-wrap items-start gap-2.5">
                <QualityAction mode="end" targetId={row.provider_id} provider={name} figure={progress} />
              </div>
            </li>
          );
        })}
      </ul>
      <Pager page={page} total={total} href={href} />
    </>
  );
}

async function FunnelTab({ locale }: { locale: string }) {
  const t = await getTranslations('Quality.admin');
  const regions = await loadFunnel();
  const tag = NUMBER_LOCALE[locale] ?? locale;
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  const rate = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="rounded-block bg-warning-light p-4 text-body-s text-warning-foreground">
        {t('funnelNote')}
      </p>
      {regions.map((region) => (
        <section
          key={region.region}
          aria-labelledby={`funnel-${region.region}`}
          className="flex flex-col gap-4 rounded-panel border border-border-light bg-surface p-5"
        >
          <h2 id={`funnel-${region.region}`} className="font-display text-title-s text-text-primary">
            {region.region}
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {FUNNEL_STAGES.map((stage) => (
              <div key={stage} className="flex flex-col gap-1 rounded-block bg-surface-secondary p-3">
                <dt className="text-meta text-text-secondary">{t(`stage.${stage}`)}</dt>
                <dd className="text-title-s font-bold text-text-primary">
                  {formatCount(region.stages[stage], locale)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-body-s">
              <caption className="pb-2 text-start text-meta text-text-secondary">
                {t('monthsCaption')}
              </caption>
              <thead>
                <tr className="text-text-secondary">
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('month')}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {t('approved')}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {t('rejected')}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {t('rate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {region.months.map((m) => (
                  <tr key={m.month} className="border-t border-border-light text-text-primary">
                    <th scope="row" className="py-2 text-start font-normal">
                      {monthLabel(m.month)}
                    </th>
                    <td className="py-2 text-end">{formatCount(m.approved, locale)}</td>
                    <td className="py-2 text-end">{formatCount(m.rejected, locale)}</td>
                    <td className="py-2 text-end">{rate(m.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
