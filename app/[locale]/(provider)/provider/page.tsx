import { CheckCircle2, Clock, Search, Send } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccountStateBanner } from '@/components/features/provider/AccountStateBanner';
import { FileProgress } from '@/components/features/provider/FileProgress';
import { FeedCard } from '@/components/features/provider-feed/FeedCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { PROVIDER_LINKS, menuLabelKey } from '@/lib/navigation/menus';
import { getProviderFile, getStanding } from '@/lib/provider/queries';
import { loadFeed, loadHomeCounts } from '@/lib/provider-feed';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';

type Props = { params: Promise<{ locale: string }> };

/**
 * The provider home (`p6`), following `provider_standing()` (spec 0006 AC-10). A null standing is an error, never draft.
 * Approved: urgent chosen banner (when > 0), KPI stat cards, latest matching requests preview + workspace sidebar,
 * or the setup prompt (spec 0009 AC-14). Below `lg`, the pages the bottom bar has no tab for are linked here (AC-15).
 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const t = await getTranslations('Provider.home');
  const tHomes = await getTranslations('Homes');
  const tFeed = await getTranslations('ProviderFeed');
  const label = await getTranslations();

  const links = (
    <nav aria-label={tFeed('home.links')} className="lg:hidden">
      <ul className="flex flex-wrap gap-2.5">
        {PROVIDER_LINKS.map(({ key, href }) => (
          <li key={key}>
            <Link
              href={href}
              className="inline-flex min-h-11 items-center rounded-full bg-surface-secondary px-5.5 py-3 text-btn-sm text-text-primary transition-colors hover:bg-accent-muted"
            >
              {label(menuLabelKey(key))}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  const [standing, file] = await Promise.all([getStanding(user.id), getProviderFile(user.id)]);

  if (!standing || !file) {
    return (
      <>
        <PageHeader title={tHomes('providerTitle')} />
        <ErrorState title={t('error.title')} body={t('error.body')} />
      </>
    );
  }

  if (standing === 'draft') {
    return (
      <>
        <PageHeader title={t('draft.title')} intro={t('draft.body')} />
        <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
          <section className="flex flex-col items-start gap-4 rounded-panel bg-accent-light p-6.5 lg:p-9">
            <p className="text-body text-text-primary">{t('draft.next')}</p>
            <Button asChild size="lg">
              <Link href="/provider/profile">{t('draft.action')}</Link>
            </Button>
          </section>
          <FileProgress file={file} />
        </div>
      </>
    );
  }

  if (standing === 'approved') {
    const context = { region: user.region };
    const result = await loadHomeCounts(context);
    if (!result.ok) {
      return (
        <>
          <PageHeader title={tHomes('providerTitle')} />
          <ErrorState title={tFeed('home.error.title')} body={tFeed('home.error.body')} />
          {links}
        </>
      );
    }
    const { counts } = result;
    if (!counts.setup_complete) {
      return (
        <>
          <PageHeader title={tHomes('providerTitle')} />
          <EmptyState
            lead={tFeed('feed.setupPrompt.lead')}
            title={tFeed('feed.setupPrompt.title')}
            body={tFeed('feed.setupPrompt.body')}
            action={
              <Button asChild size="lg">
                <Link href="/provider/setup">{tFeed('feed.setupPrompt.action')}</Link>
              </Button>
            }
          />
          {links}
        </>
      );
    }

    const recentFeed = await loadFeed(
      { serviceIds: null, zoneIds: null, when: 'all', after: null },
      locale,
      context,
    ).catch(() => ({ ok: false as const }));
    const previewRows = recentFeed.ok ? recentFeed.page.rows.slice(0, 3) : [];
    const fallback = regionDefaultLocale(user.region ?? 'TR');
    const text = (value: unknown) => localized(value, locale, fallback);

    return (
      <>
        <PageHeader title={tHomes('providerTitle')} />

        {counts.selected > 0 ? (
          <section className="flex flex-col gap-4 rounded-panel bg-surface-inverse p-6.5 text-text-inverse sm:flex-row sm:items-center sm:justify-between lg:p-8">
            <div className="flex flex-col gap-1.5">
              <span className="text-eyebrow uppercase text-accent-light">
                {tFeed('home.chosenBannerEyebrow')}
              </span>
              <h2 className="font-display text-section text-text-inverse">
                {tFeed('home.chosenBannerTitle')}
              </h2>
              <p className="max-w-52ch text-body-s text-accent-light">{tFeed('home.chosenBannerBody')}</p>
            </div>
            <Button asChild variant="white" size="lg" className="shrink-0 self-start sm:self-center">
              <Link href="/provider/applications?tab=chosen">{tFeed('home.chosenBannerAction')}</Link>
            </Button>
          </section>
        ) : null}

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={tFeed('home.open')}
            value={counts.open_requests}
            note={tFeed('home.openBody')}
            icon={<Search aria-hidden className="size-5" />}
            tone="emphasis"
            href="/provider/feed"
          />
          <StatCard
            label={tFeed('home.applied')}
            value={counts.applied}
            note={tFeed('home.appliedBody')}
            icon={<Send aria-hidden className="size-5" />}
            tone="tinted"
            href="/provider/applications"
          />
          {counts.selected > 0 ? (
            <StatCard
              label={tFeed('home.selected')}
              value={counts.selected}
              note={tFeed('home.selectedBody')}
              icon={<Clock aria-hidden className="size-5" />}
              tone="emphasis"
              href="/provider/applications?tab=chosen"
            />
          ) : null}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
          <section aria-labelledby="provider-recent-open" className="flex min-w-0 flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="provider-recent-open" className="font-display text-section text-text-primary">
                {tFeed('home.recentOpen')}
              </h2>
              <Button asChild variant="secondary" size="sm">
                <Link href="/provider/feed">{tFeed('home.viewAllFeed')}</Link>
              </Button>
            </div>
            {!recentFeed.ok ? (
              <ErrorState title={tFeed('feed.error.title')} body={tFeed('feed.error.body')} />
            ) : previewRows.length === 0 ? (
              <EmptyState
                lead={tFeed('feed.empty.lead')}
                title={tFeed('feed.empty.title')}
                body={tFeed('feed.empty.body')}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {previewRows.map((row) => (
                  <FeedCard
                    key={row.id}
                    href={`/provider/feed/${row.id}`}
                    title={text(row.service_name)}
                    where={`${text(row.zone_name)} · ${instantLabel(
                      row.scheduled_start_at,
                      recentFeed.ok ? recentFeed.page.timezone : 'Europe/Istanbul',
                      locale,
                    )}`}
                    price={row.fixed_price}
                    currency={row.currency}
                    offers={tFeed('feed.offers', { count: row.applied_count, cap: row.cap })}
                    appliedLabel={row.application ? tFeed('feed.applied') : null}
                    full={row.full}
                    fullLabel={tFeed('feed.full')}
                    actionLabel={tFeed('feed.details')}
                  />
                ))}
              </ul>
            )}
          </section>

          <aside className="flex flex-col gap-3.5">
            <section className="flex flex-col gap-3 rounded-panel bg-surface-secondary p-6">
              <h2 className="text-eyebrow uppercase text-text-secondary">{tFeed('home.rulesTitle')}</h2>
              <ul className="flex flex-col gap-2.5 text-body-s text-text-primary">
                {(['rule1', 'rule2', 'rule3'] as const).map((rule) => (
                  <li key={rule} className="flex items-start gap-2.5">
                    <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span>{tFeed(`home.${rule}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        {links}
      </>
    );
  }

  return (
    <>
      <PageHeader title={tHomes('providerTitle')} />
      <AccountStateBanner standing={standing} file={file} />
      {links}
    </>
  );
}
