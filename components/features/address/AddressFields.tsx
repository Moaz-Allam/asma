'use client';

import { MapPinIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ADDRESS_LIMITS, placeFold, type AddressDraft, type AddressTextKey } from '@/lib/address/parts';
import { LazyMapPicker, type GeocodedParts, type Point } from '@/lib/maps/lazy';
import { cn } from '@/lib/utils';

/**
 * The structured address (spec 0011-20b AC-4, AC-5, AC-11): the Turkish parts as fields, the record of the address;
 * the map an optional helper behind **Pick on the map** (only with a key, X-21). A settled pin fills what the
 * geocoder named and the fields stay editable. One component for the customer's request (il and ilçe read only, from
 * the zone) and the provider's own address (il and ilçe typed). Labels in the reader's locale; values as typed.
 */

const AUTOCOMPLETE: Partial<Record<AddressTextKey, string>> = {
  street: 'address-line1',
  postal_code: 'postal-code',
};

export type AddressFieldErrors = Partial<Record<AddressTextKey | 'pin', string>>;

export function AddressFields({
  mode,
  value,
  onChange,
  errors,
  place,
  mapKey,
  idPrefix = 'address',
}: {
  mode: 'request' | 'provider';
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
  errors: AddressFieldErrors;
  /** The zone's il and ilçe (request only), shown read only and used to centre the map. */
  place?: { il: string | null; ilce: string | null };
  mapKey: string | null;
  idPrefix?: string;
}) {
  const t = useTranslations('Address');
  const [open, setOpen] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const provider = mode === 'provider';
  const pin: Point | null =
    typeof value.lat === 'number' && typeof value.lng === 'number'
      ? { lat: value.lat, lng: value.lng }
      : null;

  function set(key: AddressTextKey, text: string) {
    onChange({ ...value, [key]: text });
  }

  function settle(at: Point, parts: GeocodedParts | null) {
    const next: AddressDraft = { ...value, lat: at.lat, lng: at.lng };
    const fillable: (keyof GeocodedParts)[] = provider
      ? ['il', 'ilce', 'mahalle', 'street', 'building_no', 'postal_code']
      : ['mahalle', 'street', 'building_no', 'postal_code'];
    for (const key of fillable) {
      const found = parts?.[key];
      if (found) next[key] = found;
    }
    onChange(next);
    // X-15: a note, never a block; the price follows the zone. A fold in the browser only.
    const zoneIlce = place?.ilce ?? null;
    setMismatch(
      !provider && parts?.ilce && zoneIlce && placeFold(parts.ilce) !== placeFold(zoneIlce)
        ? t('map.mismatch', { found: parts.ilce, zone: zoneIlce })
        : null,
    );
  }

  function field(
    key: AddressTextKey,
    options: { optional?: boolean; wide?: boolean; inputMode?: 'numeric' } = {},
  ) {
    const id = `${idPrefix}-${key}`;
    const error = errors[key];
    const label = options.optional ? t('optional', { label: t(`fields.${key}`) }) : t(`fields.${key}`);
    return (
      <div className={cn(options.wide && 'sm:col-span-2')}>
        <FormField id={id} label={label} error={error}>
          {key === 'directions' ? (
            <Textarea
              id={id}
              value={value[key] ?? ''}
              maxLength={ADDRESS_LIMITS[key].max + 20}
              rows={3}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => set(key, e.target.value)}
            />
          ) : (
            <Input
              id={id}
              value={value[key] ?? ''}
              maxLength={ADDRESS_LIMITS[key].max + 20}
              inputMode={options.inputMode}
              autoComplete={AUTOCOMPLETE[key] ?? 'off'}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => set(key, e.target.value)}
            />
          )}
        </FormField>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {provider ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {field('il')}
          {field('ilce')}
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-3 rounded-block bg-surface-secondary p-4">
          <div className="flex flex-col gap-1">
            <dt className="text-meta text-text-secondary">{t('fields.il')}</dt>
            <dd className="text-body font-semibold text-text-primary">{place?.il ?? t('fromZoneMissing')}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-meta text-text-secondary">{t('fields.ilce')}</dt>
            <dd className="text-body font-semibold text-text-primary">
              {place?.ilce ?? t('fromZoneMissing')}
            </dd>
          </div>
        </dl>
      )}
      {provider ? null : <p className="text-meta text-text-secondary">{t('fromZone')}</p>}

      {mapKey ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <MapPinIcon aria-hidden className="size-4" />
            {t('map.open')}
          </Button>
          {pin ? (
            <>
              <span className="text-meta text-text-secondary">{t('map.pinned')}</span>
              <Button
                type="button"
                variant="link"
                size="text"
                className="min-h-11"
                onClick={() => {
                  onChange({ ...value, lat: null, lng: null });
                  setMismatch(null);
                }}
              >
                {t('map.remove')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {errors.pin ? <p className="text-meta text-error">{errors.pin}</p> : null}
      {mismatch ? (
        <p role="status" className="rounded-block bg-info-light p-3 text-body-s text-info-foreground">
          {mismatch}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {field('mahalle')}
        {field('street')}
        {field('building_no')}
        {field('floor', { optional: true })}
        {field('apartment', { optional: true })}
        {field('postal_code', { optional: true, inputMode: 'numeric' })}
        {provider ? null : field('directions', { optional: true, wide: true })}
      </div>

      {mapKey ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            closeLabel={t('map.close')}
            className="max-h-svh overflow-y-auto lg:inset-x-auto lg:end-6 lg:bottom-6 lg:w-xl lg:rounded-panel lg:border-2"
          >
            <SheetHeader className="pe-12">
              <SheetTitle>{t('map.title')}</SheetTitle>
              <SheetDescription>{t('map.description')}</SheetDescription>
            </SheetHeader>
            {open ? (
              <LazyMapPicker
                apiKey={mapKey}
                place={place ?? { il: value.il ?? null, ilce: value.ilce ?? null }}
                pin={pin}
                onSettle={settle}
              />
            ) : null}
            <div className="px-5 pb-5">
              <Button type="button" size="block" onClick={() => setOpen(false)}>
                {t('map.done')}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
