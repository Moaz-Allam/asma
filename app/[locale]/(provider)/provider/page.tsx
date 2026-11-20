import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccountStateBanner } from '@/components/features/provider/AccountStateBanner';
import { FileProgress } from '@/components/features/provider/FileProgress';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { PROVIDER_LINKS, menuLabelKey } from '@/lib/navigation/menus';
import { getProviderFile, getStanding } from '@/lib/provider/queries';
import { loadHomeCounts } from '@/lib/provider-feed';

type Props = { params: Promise<{ locale: string }> };

/**
 * The provider home follows `provider_standing()` (spec 0006 AC-10). A null standing is an error, never draft.
 * Approved: two count cards, or the setup prompt (spec 0009 AC-14). Below `lg`, the pages the bottom bar has
 * no tab for are linked here (AC-15).
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
              className="inline-flex min-h-11 items-center rounded-full bg-surface-secondary px-5.5 py-3 text-btn-sm text-text-primary"
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
    const result = await loadHomeCounts({ region: user.region });
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
    return (
      <>
        <PageHeader title={tHomes('providerTitle')} />
        {counts.setup_complete ? (
          <ul className="grid gap-3.5 sm:grid-cols-2">
            {[
              {
                href: '/provider/feed',
                count: counts.open_requests,
                title: tFeed('home.open'),
                body: tFeed('home.openBody'),
              },
              {
                href: '/provider/applications',
                count: counts.applied,
                title: tFeed('home.applied'),
                body: tFeed('home.appliedBody'),
              },
              ...(counts.selected > 0
                ? [
                    {
                      href: '/provider/applications',
                      count: counts.selected,
                      title: tFeed('home.selected'),
                      body: tFeed('home.selectedBody'),
                    },
                  ]
                : []),
            ].map((card) => (
              <li key={card.title}>
                <Link
                  href={card.href}
                  className="flex flex-col gap-2 rounded-panel bg-accent-light p-6.5 transition hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-display text-price-l text-text-primary">{card.count}</span>
                  <span className="font-display text-card text-text-primary">{card.title}</span>
                  <span className="text-body-s text-text-secondary">{card.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
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
        )}
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
