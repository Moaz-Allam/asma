import { getTranslations, setRequestLocale } from 'next-intl/server';

import { FeedCard } from '@/components/features/provider-feed/FeedCard';
import { StandingNotice } from '@/components/features/provider-feed/StandingNotice';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { getProviderFile, getStanding } from '@/lib/provider/queries';
import { loadFeed, loadSetup } from '@/lib/provider-feed';
import { parseWhen, WHEN, type When } from '@/lib/provider-feed/constants';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';
import { cn } from '@/lib/utils';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.filter((v) => UUID.test(v)))].slice(0, 100);
}

/**
 * `p10`, the provider's feed (spec 0009 AC-5, AC-6, AC-15): open requests that match the provider's services
 * and districts, inside working hours first, then an "outside your working hours" divider. Filters live in the
 * URL and can only narrow. Not approved: 02's standing page. Approved without a complete setup: the setup
 * prompt.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const query = await searchParams;
  const t = await getTranslations('ProviderFeed');
  const context = { region: user.region };

  const [standing, file] = await Promise.all([getStanding(user.id), getProviderFile(user.id)]);
  const header = <PageHeader title={t('feed.title')} intro={t('feed.intro')} />;
  if (!standing || !file) {
    return (
      <>
        {header}
        <ErrorState title={t('feed.error.title')} body={t('feed.error.body')} />
      </>
    );
  }
  if (standing !== 'approved') {
    return (
      <>
        {header}
        <StandingNotice standing={standing} file={file} />
      </>
    );
  }

  const serviceFilter = ids(query.service);
  const zoneFilter = ids(query.zone);
  const when = parseWhen(query.when);
  const after = typeof query.after === 'string' ? query.after : null;

  const [setup, feed] = await Promise.all([
    loadSetup(context),
    loadFeed(
      {
        serviceIds: serviceFilter.length > 0 ? serviceFilter : null,
        zoneIds: zoneFilter.length > 0 ? zoneFilter : null,
        when,
        after,
      },
      locale,
      context,
    ),
  ]);

  if (!setup.ok || !feed.ok) {
    return (
      <>
        {header}
        <ErrorState title={t('feed.error.title')} body={t('feed.error.body')} />
      </>
    );
  }

  if (!setup.setup.complete) {
    return (
      <>
        {header}
        <EmptyState
          lead={t('feed.setupPrompt.lead')}
          title={t('feed.setupPrompt.title')}
          body={t('feed.setupPrompt.body')}
          action={
            <Button asChild size="lg">
              <Link href="/provider/setup">{t('feed.setupPrompt.action')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const fallback = regionDefaultLocale(setup.setup.region);
  const text = (value: unknown) => localized(value, locale, fallback);
  const myServices = setup.setup.categories.flatMap((c) => c.services.filter((s) => s.selected));
  const myZones = setup.setup.zones.filter((z) => z.selected);

  const hrefWith = (change: { service?: string[]; zone?: string[]; when?: When; after?: string | null }) => {
    const next = {
      service: change.service ?? serviceFilter,
      zone: change.zone ?? zoneFilter,
      when: change.when ?? when,
      after: change.after ?? null,
    };
    return {
      pathname: '/provider/feed' as const,
      query: {
        ...(next.service.length > 0 ? { service: next.service } : {}),
        ...(next.zone.length > 0 ? { zone: next.zone } : {}),
        ...(next.when !== 'all' ? { when: next.when } : {}),
        ...(next.after ? { after: next.after } : {}),
      },
    };
  };
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const chip = (key: string, label: string, on: boolean, href: ReturnType<typeof hrefWith>) => (
    <li key={key}>
      <Link
        href={href}
        aria-current={on ? 'true' : undefined}
        className={cn(
          'inline-flex min-h-11 items-center rounded-full px-5 py-3 text-btn-sm transition focus-visible:ring-2 focus-visible:ring-ring',
          on ? 'bg-accent text-accent-foreground' : 'bg-surface text-text-primary',
        )}
      >
        {label}
      </Link>
    </li>
  );

  const rows = feed.page.rows;
  const firstOutside = rows.findIndex((row) => row.outside_hours);

  return (
    <>
      {header}
      <div className="grid items-start gap-3.5 lg:grid-cols-[1fr_2fr]">
        <aside
          aria-label={t('feed.filters')}
          className="flex flex-col gap-5 rounded-panel bg-surface-secondary p-5 lg:sticky lg:top-4"
        >
          <nav aria-label={t('feed.services')} className="flex flex-col gap-2">
            <p className="text-body-s font-bold text-text-primary">{t('feed.services')}</p>
            <ul className="flex flex-wrap gap-2">
              {myServices.map((s) =>
                chip(
                  s.id,
                  text(s.name),
                  serviceFilter.includes(s.id),
                  hrefWith({ service: toggle(serviceFilter, s.id) }),
                ),
              )}
            </ul>
          </nav>
          <nav aria-label={t('feed.zones')} className="flex flex-col gap-2">
            <p className="text-body-s font-bold text-text-primary">{t('feed.zones')}</p>
            <ul className="flex flex-wrap gap-2">
              {myZones.map((z) =>
                chip(
                  z.id,
                  text(z.name),
                  zoneFilter.includes(z.id),
                  hrefWith({ zone: toggle(zoneFilter, z.id) }),
                ),
              )}
            </ul>
          </nav>
          <nav aria-label={t('feed.when')} className="flex flex-col gap-2">
            <p className="text-body-s font-bold text-text-primary">{t('feed.when')}</p>
            <ul className="flex flex-wrap gap-2">
              {WHEN.map((w) =>
                chip(
                  w,
                  t(w === 'all' ? 'feed.whenAll' : w === 'week' ? 'feed.whenWeek' : 'feed.whenNext'),
                  when === w,
                  hrefWith({ when: w }),
                ),
              )}
            </ul>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-3.5">
          {rows.length === 0 ? (
            <EmptyState
              lead={t('feed.empty.lead')}
              title={t('feed.empty.title')}
              body={t('feed.empty.body')}
            />
          ) : (
            <ul className="flex flex-col gap-3.5">
              {rows.map((row, index) => (
                <FeedRowItem
                  key={row.id}
                  divider={index === firstOutside ? t('feed.outside') : null}
                  card={
                    <FeedCard
                      href={`/provider/feed/${row.id}`}
                      title={text(row.service_name)}
                      where={`${text(row.zone_name)} · ${instantLabel(row.scheduled_start_at, feed.page.timezone, locale)}`}
                      price={row.fixed_price}
                      currency={row.currency}
                      offers={t('feed.offers', { count: row.applied_count, cap: row.cap })}
                      appliedLabel={row.application ? t('feed.applied') : null}
                      full={row.full}
                      fullLabel={t('feed.full')}
                      actionLabel={t('feed.details')}
                    />
                  }
                />
              ))}
            </ul>
          )}
          {feed.next ? (
            <Button asChild variant="secondary" className="self-center">
              <Link href={hrefWith({ after: feed.next })}>{t('feed.more')}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** The divider sits before the first card outside the provider's hours, as its own list item. */
function FeedRowItem({ divider, card }: { divider: string | null; card: React.ReactNode }) {
  if (!divider) return card;
  return (
    <>
      <li className="pt-2">
        <h2 className="text-eyebrow text-text-secondary">{divider}</h2>
      </li>
      {card}
    </>
  );
}
