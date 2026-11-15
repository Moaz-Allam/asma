import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PricingEditor } from '@/components/features/admin/pricing/PricingEditor';
import { ServicePicker } from '@/components/features/admin/pricing/ServicePicker';
import type { EditorModifier } from '@/components/features/admin/pricing/types';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import type { EffectType, MatchType } from '@/lib/catalog/options';
import {
  activeFormula,
  adminRegion,
  listAddons,
  listServicesForPricing,
  listZones,
  pricedQuestions,
} from '@/lib/catalog/queries';
import { formatMinor } from '@/lib/money/parse';
import { reportServerError } from '@/lib/observability/server';
import { currencyFor } from '@/lib/region';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ service?: string | string[] }>;
};

/**
 * `/admin/pricing` (spec 0007 AC-20, AC-21). `?service=` is checked and falls back silently to the first
 * service, by category order, then service order, then id. The version shown is the active formula's, or 0,
 * and is the version a publish expects. Amounts reach the fields as form text made here.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const t = await getTranslations('AdminPricing');
  const query = await searchParams;
  const asked = Array.isArray(query.service) ? query.service[0] : query.service;

  const where = await adminRegion();
  const failed = (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      <ErrorState title={t('errorTitle')} body={t('errorBody')} />
    </>
  );
  if (!where) return failed;
  const { region, defaultLocale } = where;
  const text = (value: unknown) => localized(value, locale, defaultLocale);

  const view = await (async () => {
    const services = await listServicesForPricing(region);
    const service = services.find((s) => s.id === asked) ?? services[0] ?? null;
    if (!service) return 'empty' as const;
    const [formula, questions, addons, zones] = await Promise.all([
      activeFormula(service.id),
      pricedQuestions(service.categoryId, service.id),
      listAddons([service.id]),
      listZones(region),
    ]);
    return {
      services: services.map((s) => ({ id: s.id, name: text(s.name), group: text(s.categoryName) })),
      service: { id: service.id, name: text(service.name) },
      version: formula?.version ?? 0,
      base: formula ? formatMinor(formula.basePrice) : '',
      modifiers: (formula?.modifiers ?? []).map<EditorModifier>((m, i) => ({
        uid: `published-${i}`,
        questionKey: m.questionKey,
        matchType: m.matchType as MatchType,
        matchValue: m.matchValue,
        effectType: m.effectType as EffectType,
        amount: m.amount === null ? null : formatMinor(m.amount),
        factor: m.factor,
      })),
      questions: questions.map((q) => ({
        key: q.key,
        label: text(q.label),
        type: q.type,
        required: q.required,
        options: q.options?.map((o) => ({ value: o.value, label: text(o.label) })) ?? null,
        validation: q.validation,
      })),
      addons: addons.map((a) => ({ id: a.id, name: text(a.name), price: a.price, active: a.active })),
      zones: zones.map((z) => ({ id: z.id, name: text(z.name), multiplier: z.multiplier, active: z.active })),
    };
  })().catch((error: unknown) => {
    // The page shows ErrorState, but the cause is reported, never silent.
    reportServerError('adminPricing', error);
    return null;
  });
  if (view === null) return failed;
  if (view === 'empty') {
    return (
      <>
        <PageHeader title={t('title')} intro={t('intro')} />
        <EmptyState lead={t('emptyLead')} title={t('emptyTitle')} body={t('emptyBody')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-end">
        <ServicePicker services={view.services} value={view.service.id} />
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <h2 className="flex-1 font-display text-subhead text-text-primary">
            {t('formulaFor', { service: view.service.name })}
          </h2>
          <StatusChip
            tone={view.version > 0 ? 'info' : 'waiting'}
            label={view.version > 0 ? t('version', { version: view.version }) : t('notPublished')}
          />
        </div>
      </div>
      <PricingEditor
        key={view.service.id}
        serviceId={view.service.id}
        version={view.version}
        publishedBase={view.base}
        publishedModifiers={view.modifiers}
        questions={view.questions}
        addons={view.addons}
        zones={view.zones}
        currency={currencyFor(region)}
      />
    </>
  );
}
