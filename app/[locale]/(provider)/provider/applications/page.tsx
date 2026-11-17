import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ApplicationRow } from '@/components/features/provider-feed/ApplicationRow';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { listApplications } from '@/lib/provider-feed';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The provider's applications, newest first, 20 a page (spec 0009 AC-13). Withdraw is position 12. */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const query = await searchParams;
  const t = await getTranslations('ProviderFeed');

  const result = await listApplications(typeof query.after === 'string' ? query.after : null, {
    region: user.region,
  });
  const header = <PageHeader title={t('applications.title')} intro={t('applications.intro')} />;
  if (!result.ok) {
    return (
      <>
        {header}
        <ErrorState title={t('applications.error.title')} body={t('applications.error.body')} />
      </>
    );
  }

  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const text = (value: unknown) => localized(value, locale, fallback);
  const { rows, timezone } = result.page;

  return (
    <>
      {header}
      {rows.length === 0 ? (
        <EmptyState
          lead={t('applications.empty.lead')}
          title={t('applications.empty.title')}
          body={t('applications.empty.body')}
          action={
            <Button asChild size="lg">
              <Link href="/provider/feed">{t('applications.empty.action')}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3.5">
          {rows.map((row) => (
            <ApplicationRow
              key={row.application.id}
              href={`/provider/feed/${row.id}`}
              status={row.application.status}
              statusLabel={t(`status.${row.application.status}`)}
              title={text(row.service_name)}
              where={`${text(row.zone_name)} · ${instantLabel(row.scheduled_start_at, timezone, locale)}`}
              applied={t('form.appliedOn', {
                date: instantLabel(row.application.created_at, timezone, locale),
              })}
              note={
                row.application.status === 'SELECTED' && row.payment_deadline
                  ? t('chosen.line', { date: instantLabel(row.payment_deadline, timezone, locale) })
                  : row.application.status === 'NOT_SELECTED'
                    ? t('chosen.notChosen')
                    : row.application.status === 'CANCELLED'
                      ? t('chosen.cancelled')
                      : null
              }
              price={row.fixed_price}
              currency={row.currency}
            />
          ))}
        </ul>
      )}
      {result.next ? (
        <Button asChild variant="secondary" className="self-center">
          <Link href={{ pathname: '/provider/applications', query: { after: result.next } }}>
            {t('applications.more')}
          </Link>
        </Button>
      ) : null}
    </>
  );
}
