'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { moveCatalogRow, setCatalogActive } from '@/actions/admin-catalog';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Link } from '@/lib/i18n/navigation';
import type { CatalogLocale } from '@/lib/catalog/localized';
import { CATALOG_TABS, type CatalogTab, type CatalogTable } from '@/lib/catalog/options';
import { cn } from '@/lib/utils';

import { AddonSheet, CategorySheet, ServiceSheet, ZoneSheet } from './CatalogSheets';
import { QuestionBuilder } from './QuestionBuilder';
import { RowControls } from './RowControls';
import type { CatalogAddon, CatalogCategory, CatalogQuestion, CatalogService, CatalogZone } from './types';
import { useCatalogAction } from './use-action';

type Sheet =
  | { kind: 'category'; row: CatalogCategory | null }
  | { kind: 'service'; row: CatalogService | null }
  | { kind: 'addon'; row: CatalogAddon | null }
  | { kind: 'zone'; row: CatalogZone | null }
  | { kind: 'question'; row: CatalogQuestion | null };

/**
 * `/admin/catalog` (`app-05`, spec 0007 AC-17 to AC-19): the categories beside a panel with four tabs. Each
 * list has up and down, a switch, add, edit and an empty state; add and edit open a sheet. Below `lg` the
 * category list stacks above the panel. The tab and the category live in the URL, so a refresh keeps them.
 */
export function CatalogBoard({
  regionDefault,
  currency,
  categories,
  categoryId,
  tab,
  questions,
  services,
  addons,
  zones,
}: {
  regionDefault: CatalogLocale;
  currency: 'TRY' | 'SAR';
  categories: CatalogCategory[];
  categoryId: string | null;
  tab: CatalogTab;
  questions: CatalogQuestion[];
  services: CatalogService[];
  addons: CatalogAddon[];
  zones: CatalogZone[];
}) {
  const t = useTranslations('AdminCatalog');
  const action = useCatalogAction();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const category = categories.find((c) => c.id === categoryId) ?? null;

  function open(next: Sheet) {
    setSheetKey((k) => k + 1);
    setSheet(next);
  }
  const close = (value: boolean) => {
    if (!value) setSheet(null);
  };
  const move = (table: CatalogTable, id: string) => (direction: 'up' | 'down') =>
    action.run(() => moveCatalogRow({ table, id, direction }));
  const toggle = (table: CatalogTable, id: string) => (active: boolean) =>
    action.run(() => setCatalogActive({ table, id, active }));

  const hrefFor = (next: { category?: string; tab?: CatalogTab }) => ({
    pathname: '/admin/catalog',
    query: { category: next.category ?? categoryId ?? undefined, tab: next.tab ?? tab },
  });

  return (
    <div className="flex flex-col gap-3.5">
      {action.error ? (
        <p role="alert" className="rounded-row bg-error-light px-5 py-3.5 text-body-s text-error-foreground">
          {action.error}
          {action.code === 'question_in_use' ? ` ${t('inUseHint')}` : null}
        </p>
      ) : null}
      <div className="grid items-start gap-3.5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section aria-labelledby="categories-title" className="flex flex-col gap-2">
          <h2 id="categories-title" className="mb-1 text-chip text-text-secondary">
            {t('categories')}
          </h2>
          {categories.length === 0 ? (
            <p className="rounded-row border-2 border-border px-4 py-3.5 text-body-s text-text-secondary">
              {t('emptyCategories')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {categories.map((c, index) => {
                const selected = c.id === categoryId;
                return (
                  <li
                    key={c.id}
                    className={cn(
                      'flex flex-col gap-2 rounded-row border-2 px-3.5 py-3',
                      selected ? 'border-accent bg-surface-secondary' : 'border-border bg-surface',
                      !c.active && 'border-dashed',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Link
                        href={hrefFor({ category: c.id })}
                        aria-current={selected ? 'true' : undefined}
                        className="flex min-h-11 flex-1 flex-col justify-center text-start"
                      >
                        <span className="text-label text-text-primary">{c.name || t('untitled')}</span>
                        <span className="text-meta text-text-secondary">
                          {t('categoryMeta', { services: c.services, questions: c.questions })}
                        </span>
                      </Link>
                      <Switch
                        checked={c.active}
                        disabled={action.busy}
                        onCheckedChange={toggle('service_categories', c.id)}
                        aria-label={t(c.active ? 'turnOff' : 'turnOn', { name: c.name })}
                      />
                    </div>
                    <Missing missing={c.missing} />
                    {selected ? (
                      <RowControls
                        name={c.name}
                        active={c.active}
                        first={index === 0}
                        last={index === categories.length - 1}
                        busy={action.busy}
                        onMove={move('service_categories', c.id)}
                        onToggle={toggle('service_categories', c.id)}
                        onEdit={() => open({ kind: 'category', row: c })}
                        showSwitch={false}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <Button
            variant="secondary"
            size="lg"
            className="mt-1"
            onClick={() => open({ kind: 'category', row: null })}
          >
            <Plus aria-hidden />
            {t('newCategory')}
          </Button>
        </section>

        <section
          aria-labelledby="panel-title"
          className="overflow-hidden rounded-block border-2 border-border"
        >
          <div className="flex flex-wrap items-center gap-2 border-b-2 border-border-light px-5.5 py-4">
            <h2 id="panel-title" className="flex-1 font-display text-subhead text-text-primary">
              {category?.name || t('noCategory')}
            </h2>
            <nav aria-label={t('tabs')} className="flex flex-wrap gap-1.5">
              {CATALOG_TABS.map((key) => (
                <Link
                  key={key}
                  href={hrefFor({ tab: key })}
                  aria-current={key === tab ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-full px-4 py-2.5 text-btn-sm',
                    key === tab
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-surface-secondary text-text-primary',
                  )}
                >
                  {t(`tab.${key}`)}
                </Link>
              ))}
            </nav>
          </div>

          {tab === 'zones' ? (
            <ZonesTab
              zones={zones}
              busy={action.busy}
              move={move}
              toggle={toggle}
              onEdit={(row) => open({ kind: 'zone', row })}
              onAdd={() => open({ kind: 'zone', row: null })}
            />
          ) : !category ? (
            <p className="px-5.5 py-6 text-body-s text-text-secondary">{t('pickCategory')}</p>
          ) : tab === 'questions' ? (
            <QuestionsTab
              questions={questions}
              busy={action.busy}
              move={move}
              toggle={toggle}
              onEdit={(row) => open({ kind: 'question', row })}
              onAdd={() => open({ kind: 'question', row: null })}
            />
          ) : tab === 'services' ? (
            <ServicesTab
              services={services}
              busy={action.busy}
              move={move}
              toggle={toggle}
              onEdit={(row) => open({ kind: 'service', row })}
              onAdd={() => open({ kind: 'service', row: null })}
            />
          ) : (
            <AddonsTab
              services={services}
              addons={addons}
              currency={currency}
              busy={action.busy}
              move={move}
              toggle={toggle}
              onEdit={(row) => open({ kind: 'addon', row })}
              onAdd={() => open({ kind: 'addon', row: null })}
            />
          )}
        </section>
      </div>

      {sheet?.kind === 'category' ? (
        <CategorySheet
          key={sheetKey}
          open
          onOpenChange={close}
          regionDefault={regionDefault}
          category={sheet.row}
        />
      ) : null}
      {sheet?.kind === 'service' && categoryId ? (
        <ServiceSheet
          key={sheetKey}
          open
          onOpenChange={close}
          regionDefault={regionDefault}
          categoryId={categoryId}
          service={sheet.row}
        />
      ) : null}
      {sheet?.kind === 'addon' ? (
        <AddonSheet
          key={sheetKey}
          open
          onOpenChange={close}
          regionDefault={regionDefault}
          services={services}
          addon={sheet.row}
          currencyLabel={currency}
        />
      ) : null}
      {sheet?.kind === 'zone' ? (
        <ZoneSheet key={sheetKey} open onOpenChange={close} regionDefault={regionDefault} zone={sheet.row} />
      ) : null}
      {sheet?.kind === 'question' && categoryId ? (
        <QuestionBuilder
          key={sheetKey}
          open
          onOpenChange={close}
          regionDefault={regionDefault}
          categoryId={categoryId}
          services={services}
          question={sheet.row}
        />
      ) : null}
    </div>
  );
}

type RowHandlers<T> = {
  busy: boolean;
  move: (table: CatalogTable, id: string) => (direction: 'up' | 'down') => void;
  toggle: (table: CatalogTable, id: string) => (active: boolean) => void;
  onEdit: (row: T) => void;
  onAdd: () => void;
};

function Missing({ missing }: { missing: CatalogLocale[] }) {
  const t = useTranslations('AdminCatalog');
  if (missing.length === 0) return null;
  return (
    <span className="text-meta text-text-secondary">
      {t('missingLocales', { locales: missing.map((locale) => t(`locale.${locale}`)).join(', ') })}
    </span>
  );
}

function AddRow({ label, onAdd, note }: { label: string; onAdd: () => void; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-5.5 py-4">
      <Button variant="secondary" onClick={onAdd}>
        <Plus aria-hidden />
        {label}
      </Button>
      {note ? <p className="flex-1 text-meta text-text-secondary">{note}</p> : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5.5 py-6 text-body-s text-text-secondary">{text}</p>;
}

function QuestionsTab({
  questions,
  busy,
  move,
  toggle,
  onEdit,
  onAdd,
}: RowHandlers<CatalogQuestion> & { questions: CatalogQuestion[] }) {
  const t = useTranslations('AdminCatalog');
  return (
    <div>
      {questions.length === 0 ? (
        <Empty text={t('emptyQuestions')} />
      ) : (
        <ul>
          {questions.map((q, index) => (
            <li
              key={q.id}
              className={cn(
                'flex flex-col gap-3 border-t-2 border-border-light px-5.5 py-3.5 first:border-t-0 xl:flex-row xl:items-center',
                !q.active && 'border-s-4 border-s-track',
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-label text-text-primary">{q.name || t('untitled')}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-secondary">
                  <span dir="ltr" className="font-mono text-text-primary">
                    {q.key}
                  </span>
                  <span>{t(`type.${q.type}`)}</span>
                  <span>{summary(q, t)}</span>
                  <span>{q.scopeName ? t('scopeOne', { service: q.scopeName }) : t('scopeAll')}</span>
                </span>
                <Missing missing={q.missing} />
                {!q.active ? (
                  <span className="text-meta text-text-secondary">{t('offKeepsAnswers')}</span>
                ) : null}
              </div>
              <StatusChip
                className="self-start xl:self-center"
                tone={q.affectsPricing ? 'info' : 'neutral'}
                label={t(q.affectsPricing ? 'pricesYes' : 'pricesNo')}
              />
              <RowControls
                name={q.name}
                active={q.active}
                first={index === 0}
                last={index === questions.length - 1}
                busy={busy}
                onMove={move('questions', q.id)}
                onToggle={toggle('questions', q.id)}
                onEdit={() => onEdit(q)}
              />
            </li>
          ))}
        </ul>
      )}
      <AddRow label={t('newQuestion')} onAdd={onAdd} note={t('questionsNote')} />
    </div>
  );
}

function summary(q: CatalogQuestion, t: ReturnType<typeof useTranslations>): string {
  const required = t(q.required ? 'requiredShort' : 'optionalShort');
  if (q.type === 'number' && q.validation) {
    return `${required} · ${t('rangeSummary', { min: q.validation.min ?? 0, max: q.validation.max ?? 0, step: q.validation.step ?? 1 })}`;
  }
  if ((q.type === 'text' || q.type === 'textarea') && q.validation?.maxLength !== undefined) {
    return `${required} · ${t('lengthSummary', { max: q.validation.maxLength })}`;
  }
  if (q.options) return `${required} · ${t('optionsSummary', { count: q.options.length })}`;
  return required;
}

function ServicesTab({
  services,
  busy,
  move,
  toggle,
  onEdit,
  onAdd,
}: RowHandlers<CatalogService> & { services: CatalogService[] }) {
  const t = useTranslations('AdminCatalog');
  return (
    <div>
      {services.length === 0 ? (
        <Empty text={t('emptyServices')} />
      ) : (
        <ul>
          {services.map((s, index) => (
            <li
              key={s.id}
              className="flex flex-col gap-3 border-t-2 border-border-light px-5.5 py-4 first:border-t-0 xl:flex-row xl:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-label text-text-primary">{s.name || t('untitled')}</span>
                <span className="text-meta text-text-secondary">
                  {[s.note, t('hoursSummary', { min: s.hoursMin, max: s.hoursMax })]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <Missing missing={s.missing} />
              </div>
              {s.state === 'no_formula' ? (
                <Link
                  href={{ pathname: '/admin/pricing', query: { service: s.id } }}
                  className="inline-flex min-h-11 items-center"
                >
                  <StatusChip
                    className="self-start xl:self-center"
                    tone="waiting"
                    label={t('state.no_formula')}
                  />
                </Link>
              ) : (
                <StatusChip
                  className="self-start xl:self-center"
                  tone={s.state === 'live' ? 'info' : 'neutral'}
                  label={t(`state.${s.state}`)}
                />
              )}
              <RowControls
                name={s.name}
                active={s.active}
                first={index === 0}
                last={index === services.length - 1}
                busy={busy}
                onMove={move('services', s.id)}
                onToggle={toggle('services', s.id)}
                onEdit={() => onEdit(s)}
              />
            </li>
          ))}
        </ul>
      )}
      <AddRow label={t('newService')} onAdd={onAdd} />
    </div>
  );
}

function AddonsTab({
  services,
  addons,
  currency,
  busy,
  move,
  toggle,
  onEdit,
  onAdd,
}: RowHandlers<CatalogAddon> & {
  services: CatalogService[];
  addons: CatalogAddon[];
  currency: 'TRY' | 'SAR';
}) {
  const t = useTranslations('AdminCatalog');
  if (services.length === 0) return <Empty text={t('addonsNeedService')} />;
  return (
    <div>
      {services.map((service) => {
        const rows = addons.filter((a) => a.serviceId === service.id);
        return (
          <section key={service.id} className="border-t-2 border-border-light first:border-t-0">
            <h3 className="px-5.5 pt-4 text-chip text-text-secondary">{service.name}</h3>
            {rows.length === 0 ? (
              <p className="px-5.5 py-3 text-body-s text-text-secondary">{t('emptyAddons')}</p>
            ) : (
              <ul>
                {rows.map((a, index) => (
                  <li key={a.id} className="flex flex-col gap-3 px-5.5 py-3.5 xl:flex-row xl:items-center">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-label text-text-primary">{a.name || t('untitled')}</span>
                      <Missing missing={a.missing} />
                    </div>
                    <MoneyDisplay
                      amount={a.price}
                      currency={currency}
                      className="text-group text-text-primary"
                    />
                    <RowControls
                      name={a.name}
                      active={a.active}
                      first={index === 0}
                      last={index === rows.length - 1}
                      busy={busy}
                      onMove={move('addons', a.id)}
                      onToggle={toggle('addons', a.id)}
                      onEdit={() => onEdit(a)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <AddRow label={t('newAddon')} onAdd={onAdd} />
    </div>
  );
}

function ZonesTab({
  zones,
  busy,
  move,
  toggle,
  onEdit,
  onAdd,
}: RowHandlers<CatalogZone> & { zones: CatalogZone[] }) {
  const t = useTranslations('AdminCatalog');
  return (
    <div>
      {zones.length === 0 ? (
        <Empty text={t('emptyZones')} />
      ) : (
        <ul>
          {zones.map((z, index) => (
            <li
              key={z.id}
              className="flex flex-col gap-3 border-t-2 border-border-light px-5.5 py-3.5 first:border-t-0 xl:flex-row xl:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-label text-text-primary">{z.name || t('untitled')}</span>
                <Missing missing={z.missing} />
              </div>
              <span className="text-meta text-text-secondary">{t('multiplier')}</span>
              <span dir="ltr" className="font-display text-group text-text-primary tabular-nums">
                ×{z.multiplier}
              </span>
              <RowControls
                name={z.name}
                active={z.active}
                first={index === 0}
                last={index === zones.length - 1}
                busy={busy}
                onMove={move('zones', z.id)}
                onToggle={toggle('zones', z.id)}
                onEdit={() => onEdit(z)}
              />
            </li>
          ))}
        </ul>
      )}
      <AddRow label={t('newZone')} onAdd={onAdd} note={t('zonesNote')} />
    </div>
  );
}
