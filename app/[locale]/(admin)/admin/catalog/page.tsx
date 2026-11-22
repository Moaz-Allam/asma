import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CatalogBoard } from '@/components/features/admin/catalog/CatalogBoard';
import type {
  CatalogAddon,
  CatalogCategory,
  CatalogQuestion,
  CatalogService,
  CatalogZone,
} from '@/components/features/admin/catalog/types';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';
import { asLocalizedText, localized, missingLocales, type CatalogLocale } from '@/lib/catalog/localized';
import { CATALOG_TABS, type CatalogTab } from '@/lib/catalog/options';
import {
  adminRegion,
  listAddons,
  listCategories,
  listApplicationQuestions,
  listQuestions,
  listServices,
  listZones,
  matchedOptionValues,
} from '@/lib/catalog/queries';
import { formatMinor } from '@/lib/money/parse';
import { reportServerError } from '@/lib/observability/server';
import { currencyFor } from '@/lib/region';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string | string[]; tab?: string | string[] }>;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `/admin/catalog` (spec 0007 AC-17 to AC-19). Every read is the admin's own, under RLS. Text is picked in
 * the page's locale here, on the server; the edit sheets get the three locales as stored. `?category=` and
 * `?tab=` are checked and fall back silently to the first category and Questions.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const t = await getTranslations('AdminCatalog');
  const query = await searchParams;

  const where = await adminRegion();
  if (!where) {
    return (
      <>
        <PageHeader title={t('title')} intro={t('intro')} />
        <ErrorState title={t('errorTitle')} body={t('errorBody')} />
      </>
    );
  }
  const { region, defaultLocale } = where;
  const text = (value: unknown) => localized(value, locale, defaultLocale);
  const texts = (value: unknown) => ({
    name: text(value),
    values: asLocalizedText(value),
    missing: missingLocales(value),
  });

  const data = await (async () => {
    const categoryRows = await listCategories(region);
    const asked = one(query.category);
    const categoryId = categoryRows.find((c) => c.id === asked)?.id ?? categoryRows[0]?.id ?? null;
    const askedTab = one(query.tab);
    const tab: CatalogTab = CATALOG_TABS.includes(askedTab as CatalogTab)
      ? (askedTab as CatalogTab)
      : 'questions';
    const [questionRows, matched, serviceRows, zoneRows, applicationRows] = await Promise.all([
      categoryId ? listQuestions(categoryId) : Promise.resolve([]),
      categoryId ? matchedOptionValues(categoryId) : Promise.resolve(new Map<string, string[]>()),
      categoryId ? listServices(region, categoryId) : Promise.resolve([]),
      listZones(region),
      categoryId ? listApplicationQuestions(categoryId) : Promise.resolve([]),
    ]);
    const addonRows = await listAddons(serviceRows.map((s) => s.id));
    const categoryActive = categoryRows.find((c) => c.id === categoryId)?.active ?? false;

    const services: CatalogService[] = serviceRows.map((s) => ({
      id: s.id,
      ...texts(s.name),
      note: s.note ? text(s.note) : '',
      noteValues: asLocalizedText(s.note),
      hoursMin: s.hoursMin,
      hoursMax: s.hoursMax,
      active: s.active,
      state: !s.active || !categoryActive ? 'off' : s.hasFormula ? 'live' : 'no_formula',
    }));
    const serviceName = new Map(services.map((s) => [s.id, s.name]));

    return {
      categoryId,
      tab,
      categories: categoryRows.map<CatalogCategory>((c) => ({
        id: c.id,
        ...texts(c.name),
        active: c.active,
        services: c.services,
        questions: c.questions,
      })),
      services,
      questions: questionRows.map<CatalogQuestion>((q) => ({
        id: q.id,
        ...texts(q.label),
        key: q.key,
        type: q.type,
        help: q.helpText ? text(q.helpText) : '',
        helpValues: asLocalizedText(q.helpText),
        required: q.required,
        affectsPricing: q.affectsPricing,
        options:
          q.options?.map((o) => ({
            value: o.value,
            label: text(o.label),
            values: asLocalizedText(o.label),
          })) ?? null,
        validation: q.validation,
        serviceId: q.serviceId,
        scopeName: q.serviceId ? (serviceName.get(q.serviceId) ?? null) : null,
        inUseValues: matched.get(q.key) ?? [],
        active: q.active,
      })),
      // Spec 0011-19b AC-2: the questions for providers, in the same row shape (no scope, never priced).
      applicationQuestions: applicationRows.map<CatalogQuestion>((q) => ({
        id: q.id,
        ...texts(q.label),
        key: q.key,
        type: q.type,
        help: q.helpText ? text(q.helpText) : '',
        helpValues: asLocalizedText(q.helpText),
        required: q.required,
        affectsPricing: false,
        options:
          q.options?.map((o) => ({
            value: o.value,
            label: text(o.label),
            values: asLocalizedText(o.label),
          })) ?? null,
        validation: q.validation,
        serviceId: null,
        scopeName: null,
        inUseValues: [],
        active: q.active,
      })),
      addons: addonRows.map<CatalogAddon>((a) => ({
        id: a.id,
        serviceId: a.serviceId,
        ...texts(a.name),
        price: a.price,
        priceText: formatMinor(a.price),
        active: a.active,
      })),
      zones: zoneRows.map<CatalogZone>((z) => ({
        id: z.id,
        ...texts(z.name),
        multiplier: z.multiplier,
        active: z.active,
      })),
    };
  })().catch((error: unknown) => {
    // The page shows ErrorState, but the cause is reported, never silent.
    reportServerError('adminCatalog', error);
    return null;
  });
  if (data === null) {
    return (
      <>
        <PageHeader title={t('title')} intro={t('intro')} />
        <ErrorState title={t('errorTitle')} body={t('errorBody')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      <CatalogBoard
        regionDefault={defaultLocale as CatalogLocale}
        currency={currencyFor(region)}
        categories={data.categories}
        categoryId={data.categoryId}
        tab={data.tab}
        questions={data.questions}
        applicationQuestions={data.applicationQuestions}
        services={data.services}
        addons={data.addons}
        zones={data.zones}
      />
    </>
  );
}
