import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RequestForm, type RequestFormInitial } from '@/components/features/requests/RequestForm';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { loadRequestCatalog, prefillFrom } from '@/lib/requests';
import { localizeCatalog } from '@/lib/requests/view';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const EMPTY: RequestFormInitial = {
  categoryId: null,
  serviceId: null,
  answers: {},
  addonIds: [],
  zoneId: null,
  addressLine: '',
  notes: '',
};

/**
 * Post a request (spec 0008 AC-19, `s4`, `s5`). The catalog comes from `request_catalog`, in the caller's
 * region, with every text put in this page's locale here. `?from=` repeats one of the caller's own requests
 * (AC-16) and `?service=` preselects a bookable service; each is validated and falls back silently.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['customer', 'admin']);
  const query = await searchParams;
  const t = await getTranslations('Requests');

  const outcome = await loadRequestCatalog({ region: user.region, userId: user.id });
  if (!outcome.ok) {
    return (
      <ErrorState
        title={t('states.loadTitle')}
        body={t(`errors.${outcome.code}` as 'errors.action_failed')}
        action={
          <Button asChild>
            <Link href="/requests/new">{t('states.retry')}</Link>
          </Button>
        }
      />
    );
  }
  const catalog = localizeCatalog(outcome.catalog, locale);
  if (catalog.categories.length === 0) {
    return (
      <EmptyState lead={t('states.emptyLead')} title={t('states.emptyTitle')} body={t('states.emptyBody')} />
    );
  }

  let initial = EMPTY;
  let repeated = false;
  let serviceGone = false;
  const prefill = await prefillFrom({ userId: user.id, id: query.from, catalog: outcome.catalog });
  if (prefill?.kind === 'prefilled') {
    initial = {
      categoryId: prefill.categoryId,
      serviceId: prefill.serviceId,
      answers: prefill.answers,
      addonIds: prefill.addonIds,
      zoneId: prefill.zoneId,
      addressLine: prefill.addressLine,
      notes: prefill.notes,
    };
    repeated = true;
  } else if (prefill?.kind === 'service_unavailable') {
    serviceGone = true;
  } else if (typeof query.service === 'string') {
    const category = catalog.categories.find((c) => c.services.some((s) => s.id === query.service));
    if (category) initial = { ...EMPTY, categoryId: category.id, serviceId: query.service };
  }

  return (
    <RequestForm
      catalog={catalog}
      locale={locale}
      initial={initial}
      repeated={repeated}
      serviceGone={serviceGone}
    />
  );
}
