import { AlertCircle, ChartColumn, ClipboardList, ShieldCheck } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { StatusChip, type ChipTone } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadFunnel, loadProbation, loadQualityFlags } from '@/lib/admin-quality';
import { FUNNEL_STAGES } from '@/lib/admin-quality/schemas';
import { loadReports } from '@/lib/admin-reports';
import { listFlags, listRequests } from '@/lib/admin-requests';
import { loadRevenue } from '@/lib/admin-revenue';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { ADMIN_LINKS } from '@/lib/navigation/menus';
import { reportServerError } from '@/lib/observability/server';
import { queuePage } from '@/lib/provider/admin-queries';
import { formatCount } from '@/lib/quality/summary';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function readDashboardPart<T>(operation: string, read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    reportServerError(operation, error);
    return null;
  }
}

type ActionItem = {
  key: string;
  kindLabel: string;
  tone: ChipTone;
  title: string;
  meta: string;
  href: string;
};

/**
 * The admin console dashboard (`app-01`): live KPI stat cards, unified "Needs action" queue across
 * provider approvals, problem reports, deadline flags, and quality watchlist, plus regional provider vetting stages
 * and "Find request by id" (spec 0011-12 AC-12). Every reader re-verifies `is_admin()`.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const t = await getTranslations('Homes');
  const tNav = await getTranslations('Nav');
  const tFind = await getTranslations('AdminRequests');
  const tReasons = await getTranslations('Reports.reasons');
  const tQuality = await getTranslations('Quality.admin');
  const tRevenue = await getTranslations('AdminRevenue');
  const tStatus = await getTranslations('Requests.status');
  const format = await getFormatter();
  const invalid = (await searchParams).find === 'invalid';

  const today = new Date().toISOString().slice(0, 10);
  const [pending, reports, flags, watchlist, probation, requests, funnel, revenue] = await Promise.all([
    readDashboardPart('adminHomePending', queuePage({ tab: 'pending', sort: 'oldest', page: 1 })),
    readDashboardPart('adminHomeReports', loadReports('open', 1)),
    readDashboardPart('adminHomeFlags', listFlags(1)),
    readDashboardPart('adminHomeQuality', loadQualityFlags(1)),
    readDashboardPart('adminHomeProbation', loadProbation(1)),
    readDashboardPart(
      'adminHomeRequests',
      listRequests({
        status: null,
        region: null,
        from: null,
        to: null,
        hasFlag: null,
        page: 1,
      }),
    ),
    readDashboardPart('adminHomeFunnel', loadFunnel()),
    readDashboardPart('adminHomeRevenue', loadRevenue({ from: today, to: today, grain: 'month' })),
  ]);

  const unavailable = tFind('errors.action_failed');
  const needsActionTotal =
    pending && reports && flags && watchlist
      ? pending.total + reports.total + flags.total + watchlist.total
      : null;
  const requestCount = requests && !('ok' in requests) ? requests.total : null;
  const revenueRows = revenue?.ok ? revenue.report.rows : null;
  const monthLabel = format.dateTime(new Date(today + 'T12:00:00Z'), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const queueItems: ActionItem[] = [
    ...(pending?.entries ?? []).slice(0, 4).map((entry) => ({
      key: `provider-${entry.id}`,
      kindLabel: t('queueKindProvider'),
      tone: 'waiting' as const,
      title: entry.name,
      meta: entry.date ? format.dateTime(new Date(entry.date), { dateStyle: 'medium' }) : '',
      href: `/admin/providers/${entry.id}`,
    })),
    ...(reports?.rows ?? []).slice(0, 4).map((row) => ({
      key: `report-${row.id}`,
      kindLabel: t('queueKindReport'),
      tone: 'negative' as const,
      title: `${tReasons(row.reason)} · ${localized(row.service, locale, regionDefaultLocale(row.region))}`,
      meta: `${row.region} · ${instantLabel(row.created_at, row.timezone, locale)}`,
      href: `/admin/reports/${row.id}`,
    })),
    ...(flags?.rows ?? []).slice(0, 4).map((row) => ({
      key: `flag-${row.id}`,
      kindLabel: t('queueKindFlag'),
      tone: 'negative' as const,
      title: `${tFind(`flag.${row.kind}`)} · ${tStatus(row.request_status)}`,
      meta: `${row.region} · ${instantLabel(row.raised_at, row.timezone, locale)}`,
      href: `/admin/requests/${row.request_id}`,
    })),
    ...(watchlist?.rows ?? []).slice(0, 3).map((row) => ({
      key: `quality-${row.id}`,
      kindLabel: t('queueKindQuality'),
      tone: 'waiting' as const,
      title: `${row.provider_name ?? tQuality('unnamed')} · ${tQuality(`kind.${row.kind}`)}`,
      meta: `${row.region} · ${instantLabel(row.raised_at, row.timezone, locale)}`,
      href: `/admin/providers/${row.provider_id}`,
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('adminTitle')} intro={t('adminIntro')} />

      <nav aria-label={t('adminLinks')} className="lg:hidden">
        <ul className="flex flex-wrap gap-2.5">
          {ADMIN_LINKS.map(({ key, href }) => (
            <li key={key}>
              <Link
                href={href}
                className="inline-flex min-h-11 items-center rounded-full bg-surface-secondary px-5.5 py-3 text-btn-sm text-text-primary transition-colors hover:bg-accent-muted"
              >
                {tNav(key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('kpiNeedsAction')}
          value={needsActionTotal === null ? '—' : formatCount(needsActionTotal, locale)}
          note={needsActionTotal === null ? unavailable : t('kpiNeedsActionNote')}
          icon={<AlertCircle aria-hidden className="size-5" />}
          tone="emphasis"
        />
        <StatCard
          label={tRevenue('summaryNet')}
          value={
            revenueRows?.length
              ? revenueRows.map((line) => (
                  <span key={line.region + line.currency} className="flex flex-wrap items-baseline gap-x-2">
                    <MoneyDisplay amount={line.net} currency={line.currency} />
                    <span className="text-meta text-text-secondary">
                      {line.region} · {line.currency}
                    </span>
                  </span>
                ))
              : '—'
          }
          note={
            revenueRows === null
              ? unavailable
              : revenueRows.length
                ? monthLabel
                : `${monthLabel} · ${tRevenue('empty')}`
          }
          icon={<ChartColumn aria-hidden className="size-5" />}
          tone="tinted"
          href="/admin/revenue"
        />
        <StatCard
          label={t('kpiTotalRequests')}
          value={requestCount === null ? '—' : formatCount(requestCount, locale)}
          note={requestCount === null ? unavailable : t('kpiTotalRequestsNote')}
          icon={<ClipboardList aria-hidden className="size-5" />}
          tone="tinted"
        />
        <StatCard
          label={t('kpiWatchlist')}
          value={watchlist && probation ? formatCount(watchlist.total + probation.total, locale) : '—'}
          note={
            watchlist && probation
              ? t('kpiWatchlistNote', { probation: probation.total, flags: watchlist.total })
              : unavailable
          }
          icon={<ShieldCheck aria-hidden className="size-5" />}
          tone="tinted"
          href="/admin/quality"
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.45fr_1fr]">
        <section
          aria-labelledby="admin-action-queue"
          className="flex min-w-0 flex-col gap-4 rounded-panel border-2 border-border bg-surface p-5.5 lg:p-6.5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="admin-action-queue" className="font-display text-section text-text-primary">
              {t('queueTitle')}
            </h2>
            <span className="rounded-full bg-accent-light px-3 py-1 text-chip tabular-nums text-text-primary">
              {needsActionTotal === null ? '—' : formatCount(needsActionTotal, locale)}
            </span>
          </div>

          {needsActionTotal === null ? (
            <p role="alert" className="text-body-s text-error-foreground">
              {unavailable}
            </p>
          ) : null}
          {queueItems.length === 0 && needsActionTotal === 0 ? (
            <EmptyState lead={t('adminLead')} title={t('adminEmpty')} body={t('adminBody')} />
          ) : (
            <ul className="divide-y-2 divide-border-light">
              {queueItems.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={item.tone} label={item.kindLabel} />
                      {item.meta ? <span className="text-meta text-text-secondary">{item.meta}</span> : null}
                    </div>
                    <p className="truncate text-body-s font-bold text-text-primary">{item.title}</p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={item.href}>{t('queueOpen')}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <form
            action={`/${locale}/admin/requests`}
            method="get"
            className="flex flex-col gap-2.5 rounded-panel bg-surface-secondary p-5.5"
            role="search"
          >
            <Label htmlFor="find-request">{tFind('find')}</Label>
            <div className="flex flex-wrap gap-2.5">
              <Input
                id="find-request"
                name="id"
                required
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="min-w-0 flex-1"
                aria-describedby={invalid ? 'find-request-error' : undefined}
                aria-invalid={invalid ? true : undefined}
              />
              <Button type="submit" size="lg">
                {tFind('findSubmit')}
              </Button>
            </div>
            {invalid ? (
              <p id="find-request-error" role="alert" className="text-body-s text-error-foreground">
                {tFind('findInvalid')}
              </p>
            ) : null}
          </form>

          {funnel === null ? (
            <p role="alert" className="text-body-s text-error-foreground">
              {tQuality('tabs.funnel')} · {unavailable}
            </p>
          ) : (
            funnel.map((region) => {
              const maxStage = Math.max(1, ...FUNNEL_STAGES.map((stage) => region.stages[stage]));
              return (
                <section
                  key={region.region}
                  aria-labelledby={`admin-funnel-${region.region}`}
                  className="flex flex-col gap-4 rounded-panel border-2 border-border bg-surface p-5.5 lg:p-6.5"
                >
                  <h2
                    id={`admin-funnel-${region.region}`}
                    className="font-display text-card text-text-primary"
                  >
                    {t('statusBreakdownTitle')} · {region.region}
                  </h2>
                  <ul className="flex flex-col gap-3">
                    {FUNNEL_STAGES.map((stage) => {
                      const value = region.stages[stage];
                      return (
                        <li key={stage} className="flex flex-col gap-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-body-s">
                            <span className="text-text-secondary">{tQuality(`stage.${stage}`)}</span>
                            <span className="font-display font-bold tabular-nums text-text-primary">
                              {formatCount(value, locale)}
                            </span>
                          </div>
                          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-accent-muted">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${(value / maxStage) * 100}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </aside>
      </div>
    </div>
  );
}
