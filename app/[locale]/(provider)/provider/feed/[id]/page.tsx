import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ApplicationForm } from '@/components/features/provider-feed/ApplicationForm';
import { ShortDetailsList } from '@/components/features/provider-feed/ShortDetailsList';
import { ErrorState } from '@/components/shared/ErrorState';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { loadRequest, type StructuredAnswer } from '@/lib/provider-feed';
import { dayParts, instantLabel, NUMBER_LOCALE, regionDefaultLocale } from '@/lib/requests/view';

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * `p8`, one request's short details and the apply form (spec 0009 AC-7 to AC-12). Everything here comes from
 * `provider_request`, which never returns the customer, the address, the notes or a typed answer. Null (not in
 * the caller's feed and never applied to) is the 404 page. No figure is computed: the job price and the cash
 * to collect are the stored minor units.
 */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const t = await getTranslations('ProviderFeed');

  const result = await loadRequest(id, { region: user.region });
  if (!result.ok) {
    return <ErrorState title={t('feed.error.title')} body={t('feed.error.body')} />;
  }
  const request = result.request;
  if (!request) notFound();

  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const text = (value: unknown) => localized(value, locale, fallback);
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);

  const answerText = (answer: StructuredAnswer): string | null => {
    if (answer.option_labels)
      return answer.option_labels.length > 0 ? list(answer.option_labels.map(text)) : null;
    if (answer.value === null) return null;
    if (answer.type === 'boolean') return answer.value ? t('detail.yes') : t('detail.no');
    if (answer.type === 'number')
      return new Intl.NumberFormat(NUMBER_LOCALE[locale] ?? locale).format(Number(answer.value));
    if (answer.type === 'date') return dayParts(String(answer.value), locale).long;
    return String(answer.value);
  };

  const rows = [
    { term: t('detail.service'), value: text(request.service_name) },
    {
      term: t('detail.addons'),
      value: request.addon_names.length > 0 ? list(request.addon_names.map(text)) : t('detail.none'),
    },
    ...request.answers.flatMap((answer) => {
      const value = answerText(answer);
      return value === null ? [] : [{ term: text(answer.label), value }];
    }),
    { term: t('detail.start'), value: instantLabel(request.scheduled_start_at, request.timezone, locale) },
    { term: t('detail.end'), value: instantLabel(request.scheduled_end_at, request.timezone, locale) },
    { term: t('detail.district'), value: text(request.zone_name) },
    { term: t('detail.address'), value: t('detail.addressHidden') },
  ];

  const state = request.closed ? 'closed' : request.full ? 'full' : 'form';

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/provider/feed"
        className="inline-flex min-h-11 items-center self-start text-body-s font-semibold text-link"
      >
        {t('detail.back')}
      </Link>
      <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3">
            <p className="text-meta text-text-secondary">
              {t('feed.offers', { count: request.applied_count, cap: request.cap })}
            </p>
            <h1 className="font-display text-title break-words text-text-primary">
              {text(request.service_name)}
            </h1>
            {request.closed ? (
              <p role="status" className="text-body font-semibold text-text-primary">
                {t('detail.closed')}
              </p>
            ) : null}
          </div>
          <ShortDetailsList rows={rows} />
          <p className="rounded-block bg-surface-secondary p-4 text-body-s text-text-secondary">
            {t('detail.privacy')}
          </p>
          <ApplicationForm
            requestId={request.id}
            application={request.application}
            state={state}
            timezone={request.timezone}
          />
        </div>
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
          <section
            aria-label={t('price.eyebrow')}
            className="flex flex-col gap-4 rounded-panel bg-accent-light p-5 lg:p-7.5"
          >
            <p className="text-body-s font-semibold text-text-primary">{t('price.eyebrow')}</p>
            <MoneyDisplay
              amount={request.fixed_price}
              currency={request.currency}
              className="text-amount text-text-primary sm:text-price-l"
            />
            <dl className="flex flex-col gap-2 rounded-block bg-surface p-4 text-body-s">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-primary">{t('price.cash')}</dt>
                <dd className="font-bold text-text-primary">
                  <MoneyDisplay amount={request.cash_due} currency={request.currency} />
                </dd>
              </div>
            </dl>
            <p className="text-meta text-text-primary">{t('price.free')}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
