'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';

import { saveAddon, saveCategory, saveService, saveZone } from '@/actions/admin-catalog';
import { FormField } from '@/components/shared/FormField';
import { LocalizedField } from '@/components/shared/LocalizedField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CatalogLocale, LocalizedText } from '@/lib/catalog/localized';
import { CATALOG_LIMITS } from '@/lib/catalog/options';

import type { CatalogAddon, CatalogCategory, CatalogService, CatalogZone } from './types';
import { useCatalogAction } from './use-action';

/**
 * The add and edit sheets of the catalog (spec 0007 AC-17, AC-19). Each sends text as typed: money and the
 * zone multiplier are parsed on the server, never here (rule 4). The database checks every rule again.
 */

export function CatalogSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  busy,
  error,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations('AdminCatalog');
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        closeLabel={t('close')}
        className={wide ? 'w-full overflow-y-auto sm:max-w-xl' : 'w-full overflow-y-auto sm:max-w-md'}
      >
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="flex flex-col gap-5 px-5">{children}</div>
          <SheetFooter>
            {error ? (
              <p role="alert" className="text-body-s text-error">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={busy}>
              {t('save')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type Common = { open: boolean; onOpenChange: (open: boolean) => void; regionDefault: CatalogLocale };

export function CategorySheet({
  open,
  onOpenChange,
  regionDefault,
  category,
}: Common & { category: CatalogCategory | null }) {
  const t = useTranslations('AdminCatalog');
  const action = useCatalogAction();
  const [name, setName] = useState<LocalizedText>(category?.values ?? {});
  return (
    <CatalogSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(category ? 'editCategory' : 'newCategory')}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        action.run(
          () => saveCategory({ id: category?.id, name }),
          () => onOpenChange(false),
        )
      }
    >
      <LocalizedField
        id="category-name"
        label={t('fieldName')}
        value={name}
        onChange={setName}
        regionDefault={regionDefault}
        maxLength={CATALOG_LIMITS.name}
      />
    </CatalogSheet>
  );
}

export function ServiceSheet({
  open,
  onOpenChange,
  regionDefault,
  categoryId,
  service,
}: Common & { categoryId: string; service: CatalogService | null }) {
  const t = useTranslations('AdminCatalog');
  const action = useCatalogAction();
  const [name, setName] = useState<LocalizedText>(service?.values ?? {});
  const [note, setNote] = useState<LocalizedText>(service?.noteValues ?? {});
  const [hoursMin, setHoursMin] = useState(String(service?.hoursMin ?? 2));
  const [hoursMax, setHoursMax] = useState(String(service?.hoursMax ?? 4));
  return (
    <CatalogSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(service ? 'editService' : 'newService')}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        action.run(
          () =>
            saveService({
              id: service?.id,
              categoryId,
              name,
              note,
              hoursMin: Number.parseInt(hoursMin, 10),
              hoursMax: Number.parseInt(hoursMax, 10),
            }),
          () => onOpenChange(false),
        )
      }
    >
      <LocalizedField
        id="service-name"
        label={t('fieldName')}
        value={name}
        onChange={setName}
        regionDefault={regionDefault}
        maxLength={CATALOG_LIMITS.name}
      />
      <LocalizedField
        id="service-note"
        optional
        label={t('fieldNote')}
        value={note}
        onChange={setNote}
        regionDefault={regionDefault}
        maxLength={CATALOG_LIMITS.name}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField id="service-hours-min" label={t('fieldHoursMin')}>
          <Input
            id="service-hours-min"
            inputMode="numeric"
            dir="ltr"
            value={hoursMin}
            onChange={(event) => setHoursMin(event.target.value)}
          />
        </FormField>
        <FormField id="service-hours-max" label={t('fieldHoursMax')}>
          <Input
            id="service-hours-max"
            inputMode="numeric"
            dir="ltr"
            value={hoursMax}
            onChange={(event) => setHoursMax(event.target.value)}
          />
        </FormField>
      </div>
      <p className="text-meta text-text-secondary">{t('hoursNote')}</p>
    </CatalogSheet>
  );
}

export function AddonSheet({
  open,
  onOpenChange,
  regionDefault,
  services,
  addon,
  currencyLabel,
}: Common & { services: CatalogService[]; addon: CatalogAddon | null; currencyLabel: string }) {
  const t = useTranslations('AdminCatalog');
  const action = useCatalogAction();
  const [serviceId, setServiceId] = useState(addon?.serviceId ?? services[0]?.id ?? '');
  const [name, setName] = useState<LocalizedText>(addon?.values ?? {});
  const [price, setPrice] = useState(addon?.priceText ?? '');
  return (
    <CatalogSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(addon ? 'editAddon' : 'newAddon')}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        action.run(
          () => saveAddon({ id: addon?.id, serviceId, name, price }),
          () => onOpenChange(false),
        )
      }
    >
      {addon ? null : (
        <FormField id="addon-service" label={t('fieldService')}>
          <select
            id="addon-service"
            className="h-15.25 w-full rounded-field border-2 border-input bg-surface px-4.5 text-body text-text-primary"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </FormField>
      )}
      <LocalizedField
        id="addon-name"
        label={t('fieldName')}
        value={name}
        onChange={setName}
        regionDefault={regionDefault}
        maxLength={CATALOG_LIMITS.name}
      />
      <FormField id="addon-price" label={t('fieldPrice', { currency: currencyLabel })} note={t('priceNote')}>
        <Input
          id="addon-price"
          inputMode="decimal"
          dir="ltr"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </FormField>
    </CatalogSheet>
  );
}

export function ZoneSheet({
  open,
  onOpenChange,
  regionDefault,
  zone,
}: Common & { zone: CatalogZone | null }) {
  const t = useTranslations('AdminCatalog');
  const action = useCatalogAction();
  const [name, setName] = useState<LocalizedText>(zone?.values ?? {});
  const [multiplier, setMultiplier] = useState(zone?.multiplier ?? '1.00');
  return (
    <CatalogSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(zone ? 'editZone' : 'newZone')}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        action.run(
          () => saveZone({ id: zone?.id, name, multiplier }),
          () => onOpenChange(false),
        )
      }
    >
      <LocalizedField
        id="zone-name"
        label={t('fieldName')}
        value={name}
        onChange={setName}
        regionDefault={regionDefault}
        maxLength={CATALOG_LIMITS.name}
      />
      <FormField id="zone-multiplier" label={t('fieldMultiplier')} note={t('multiplierNote')}>
        <Input
          id="zone-multiplier"
          inputMode="decimal"
          dir="ltr"
          value={multiplier}
          onChange={(event) => setMultiplier(event.target.value)}
        />
      </FormField>
    </CatalogSheet>
  );
}
